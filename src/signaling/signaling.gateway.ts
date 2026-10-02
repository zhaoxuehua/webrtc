import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnModuleInit } from '@nestjs/common';

export interface UserInfo {
  name: string;
  isBusy: boolean;
  peerId?: string;
  roomId?: string;
}

@WebSocketGateway({
  cors: { origin: '*' },
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  // 记录用户信息: { socketId: { name, isBusy } }
  private users = new Map<string, UserInfo>();
  // 记录房间信息: { roomId: Set<socketId> }
  private rooms = new Map<string, Set<string>>();
  // 记录房间元数据 (房间名和创建时间)
  private roomMetadata = new Map<string, { name: string; createdAt: number }>();

  onModuleInit() {
    setInterval(() => {
      this.broadcastUserList();
      this.broadcastRoomList();
    }, 2000);
  }

  handleConnection(client: Socket) {
    console.log(`Socket connected: ${client.id}`);
    this.broadcastUserList();
    this.broadcastRoomList();
  }

  handleDisconnect(client: Socket) {
    const user = this.users.get(client.id);
    if (user && user.peerId) {
      // Notify the peer about the abrupt disconnection
      this.server.to(user.peerId).emit('peer-hungup', { from: client.id });
      // Reset peer's status
      const peer = this.users.get(user.peerId);
      if (peer) {
        peer.isBusy = false;
        peer.peerId = undefined;
      }
    }

    // 处理房间退出
    this.handleLeaveRoom(client);

    this.users.delete(client.id);
    this.broadcastUserList();
    console.log(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('register')
  handleRegister(client: Socket, userName: string) {
    this.users.set(client.id, { name: userName, isBusy: false });
    this.broadcastUserList();
    this.broadcastRoomList();
  }

  @SubscribeMessage('offer')
  handleOffer(client: Socket, payload: { to: string; offer: any; fromName: string }) {
    const target = this.users.get(payload.to);
    const caller = this.users.get(client.id);
    
    // 1. 双重安全检查：拨打方或目标方任何一人忙碌，都拒绝
    if ((target && target.isBusy) || (caller && caller.isBusy)) {
      client.emit('busy-signal', { to: payload.to, name: target ? target.name : '对方' });
      return;
    }

    // 2. 抢占状态：一旦拨打，双方立刻进入忙碌状态（锁定），并记录通信对象
    if (caller) { caller.isBusy = true; caller.peerId = payload.to; }
    if (target) { target.isBusy = true; target.peerId = client.id; }

    this.server.to(payload.to).emit('offer', {
      from: client.id,
      fromName: payload.fromName,
      offer: payload.offer,
    });
    this.broadcastUserList();
  }

  @SubscribeMessage('answer')
  handleAnswer(client: Socket, payload: { to: string; answer: any; fromName: string }) {
    const target = this.users.get(client.id);
    if (target) target.isBusy = true; // 接听方现在也忙碌了

    this.server.to(payload.to).emit('answer', {
      from: client.id,
      fromName: payload.fromName,
      answer: payload.answer,
    });
    this.broadcastUserList();
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(client: Socket, payload: { to: string; candidate: any }) {
    this.server.to(payload.to).emit('ice-candidate', {
      from: client.id,
      candidate: payload.candidate,
    });
  }

  @SubscribeMessage('hangup')
  handleHangup(client: Socket, payload: { to: string }) {
    // 双方解除忙碌状态并清理通信记录
    const u1 = this.users.get(client.id);
    const u2 = this.users.get(payload.to);
    if (u1) { u1.isBusy = false; u1.peerId = undefined; }
    if (u2) { u2.isBusy = false; u2.peerId = undefined; }

    this.server.to(payload.to).emit('peer-hungup', { from: client.id });
    this.broadcastUserList();
  }

  // --- 房间相关逻辑 ---

  @SubscribeMessage('create-room')
  handleCreateRoom(client: Socket, roomName: string) {
    const roomId = `room_${Math.random().toString(36).substr(2, 9)}`;
    this.roomMetadata.set(roomId, {
      name: roomName || '未命名会议',
      createdAt: Date.now()
    });
    
    // 防止“创建了但不加入”导致的幽灵房间内存泄漏
    this.rooms.set(roomId, new Set());
    setTimeout(() => {
      const members = this.rooms.get(roomId);
      if (members && members.size === 0) {
        this.rooms.delete(roomId);
        this.roomMetadata.delete(roomId);
        this.broadcastRoomList();
      }
    }, 5000);

    return roomId;
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(client: Socket, roomId: string) {
    // 幂等防抖：如果用户已经在这个房间里，则只同步信息，避免触发“误杀”逻辑
    const targetMembers = this.rooms.get(roomId);
    const meta = this.roomMetadata.get(roomId);
    if (targetMembers && targetMembers.has(client.id)) {
      client.emit('room-info', {
        id: roomId,
        name: meta?.name || '未知会议',
        roomAge: meta?.createdAt ? Date.now() - meta.createdAt : 0
      });
      return;
    }

    // 先退出旧房间（如果身处其他房间）
    this.handleLeaveRoom(client);

    let members = this.rooms.get(roomId);
    if (!members) {
      members = new Set();
      this.rooms.set(roomId, members);
    }
    
    // 如果房间没有元数据记录（异常情况预案），设置一个默认名称
    if (!this.roomMetadata.has(roomId)) {
      this.roomMetadata.set(roomId, {
        name: `会议 (${roomId.slice(-4)})`,
        createdAt: Date.now()
      });
    }

    // 通知房间内已有成员，有新人加入
    members.forEach(memberId => {
      this.server.to(memberId).emit('user-joined-room', {
        id: client.id,
        name: this.users.get(client.id)?.name || '未知用户'
      });
    });

    members.add(client.id);
    client.join(roomId);

    // 发送权威房间信息给加入者，包含已有成员列表
    const finalMeta = this.roomMetadata.get(roomId);
    client.emit('room-info', {
      id: roomId,
      name: finalMeta?.name,
      roomAge: finalMeta?.createdAt ? Date.now() - finalMeta.createdAt : 0,
      members: Array.from(members).map(mid => ({
        id: mid,
        name: this.users.get(mid)?.name || '未知用户'
      }))
    });

    // 设置用户为忙碌状态及绑定房间引用
    const user = this.users.get(client.id);
    if (user) {
        user.isBusy = true;
        user.roomId = roomId;
    }
    this.broadcastUserList();
    
    this.broadcastRoomList();
    console.log(`User ${client.id} joined room ${roomId}`);
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(client: Socket) {
    const user = this.users.get(client.id);
    if (!user || !user.roomId) return;

    const roomId = user.roomId;
    const members = this.rooms.get(roomId);
    
    if (members && members.has(client.id)) {
      members.delete(client.id);
      client.leave(roomId);
      
      // 通知房间内其它成员有人离开
      members.forEach(memberId => {
        this.server.to(memberId).emit('user-left-room', { id: client.id });
      });

      // 重置状态
      user.isBusy = false;
      user.roomId = undefined;
      this.broadcastUserList();

      // 如果房间空了，清理元数据
      if (members.size === 0) {
        this.rooms.delete(roomId);
        this.roomMetadata.delete(roomId);
      }
    }
    this.broadcastRoomList();
  }

  @SubscribeMessage('room-signal')
  handleRoomSignal(client: Socket, payload: { to: string; signal: any }) {
    const fromUser = this.users.get(client.id);
    // 房间内的点对点信令转发
    this.server.to(payload.to).emit('room-signal', {
      from: client.id,
      fromName: fromUser?.name || '未知用户',
      signal: payload.signal,
    });
  }

  private broadcastRoomList() {
    const roomList = Array.from(this.rooms.entries()).map(([id, members]) => ({
      id,
      name: this.roomMetadata.get(id)?.name || '未知房间',
      memberCount: members.size
    }));
    this.server.emit('room-list', roomList);
  }

  public getOnlineUsers() {
    return Object.fromEntries(this.users);
  }

  private broadcastUserList() {
    const userList = Array.from(this.users.entries()).map(([id, info]) => ({
      id,
      name: info.name,
      isBusy: info.isBusy,
    }));
    this.server.emit('user-list', userList);
  }
}
