"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalingGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
let SignalingGateway = class SignalingGateway {
    server;
    users = new Map();
    rooms = new Map();
    roomMetadata = new Map();
    onModuleInit() {
        setInterval(() => {
            this.broadcastUserList();
            this.broadcastRoomList();
        }, 2000);
    }
    handleConnection(client) {
        console.log(`Socket connected: ${client.id}`);
        this.broadcastUserList();
        this.broadcastRoomList();
    }
    handleDisconnect(client) {
        const user = this.users.get(client.id);
        if (user && user.peerId) {
            this.server.to(user.peerId).emit('peer-hungup', { from: client.id });
            const peer = this.users.get(user.peerId);
            if (peer) {
                peer.isBusy = false;
                peer.peerId = undefined;
            }
        }
        this.handleLeaveRoom(client);
        this.users.delete(client.id);
        this.broadcastUserList();
        console.log(`Socket disconnected: ${client.id}`);
    }
    handleRegister(client, userName) {
        this.users.set(client.id, { name: userName, isBusy: false });
        this.broadcastUserList();
        this.broadcastRoomList();
    }
    handleOffer(client, payload) {
        const target = this.users.get(payload.to);
        const caller = this.users.get(client.id);
        if ((target && target.isBusy) || (caller && caller.isBusy)) {
            client.emit('busy-signal', { to: payload.to, name: target ? target.name : '对方' });
            return;
        }
        if (caller) {
            caller.isBusy = true;
            caller.peerId = payload.to;
        }
        if (target) {
            target.isBusy = true;
            target.peerId = client.id;
        }
        this.server.to(payload.to).emit('offer', {
            from: client.id,
            fromName: payload.fromName,
            offer: payload.offer,
        });
        this.broadcastUserList();
    }
    handleAnswer(client, payload) {
        const target = this.users.get(client.id);
        if (target)
            target.isBusy = true;
        this.server.to(payload.to).emit('answer', {
            from: client.id,
            fromName: payload.fromName,
            answer: payload.answer,
        });
        this.broadcastUserList();
    }
    handleIceCandidate(client, payload) {
        this.server.to(payload.to).emit('ice-candidate', {
            from: client.id,
            candidate: payload.candidate,
        });
    }
    handleHangup(client, payload) {
        const u1 = this.users.get(client.id);
        const u2 = this.users.get(payload.to);
        if (u1) {
            u1.isBusy = false;
            u1.peerId = undefined;
        }
        if (u2) {
            u2.isBusy = false;
            u2.peerId = undefined;
        }
        this.server.to(payload.to).emit('peer-hungup', { from: client.id });
        this.broadcastUserList();
    }
    handleCreateRoom(client, roomName) {
        const roomId = `room_${Math.random().toString(36).substr(2, 9)}`;
        this.roomMetadata.set(roomId, {
            name: roomName || '未命名会议',
            createdAt: Date.now()
        });
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
    handleJoinRoom(client, roomId) {
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
        this.handleLeaveRoom(client);
        let members = this.rooms.get(roomId);
        if (!members) {
            members = new Set();
            this.rooms.set(roomId, members);
        }
        if (!this.roomMetadata.has(roomId)) {
            this.roomMetadata.set(roomId, {
                name: `会议 (${roomId.slice(-4)})`,
                createdAt: Date.now()
            });
        }
        members.forEach(memberId => {
            this.server.to(memberId).emit('user-joined-room', {
                id: client.id,
                name: this.users.get(client.id)?.name || '未知用户'
            });
        });
        members.add(client.id);
        client.join(roomId);
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
        const user = this.users.get(client.id);
        if (user) {
            user.isBusy = true;
            user.roomId = roomId;
        }
        this.broadcastUserList();
        this.broadcastRoomList();
        console.log(`User ${client.id} joined room ${roomId}`);
    }
    handleLeaveRoom(client) {
        const user = this.users.get(client.id);
        if (!user || !user.roomId)
            return;
        const roomId = user.roomId;
        const members = this.rooms.get(roomId);
        if (members && members.has(client.id)) {
            members.delete(client.id);
            client.leave(roomId);
            members.forEach(memberId => {
                this.server.to(memberId).emit('user-left-room', { id: client.id });
            });
            user.isBusy = false;
            user.roomId = undefined;
            this.broadcastUserList();
            if (members.size === 0) {
                this.rooms.delete(roomId);
                this.roomMetadata.delete(roomId);
            }
        }
        this.broadcastRoomList();
    }
    handleRoomSignal(client, payload) {
        const fromUser = this.users.get(client.id);
        this.server.to(payload.to).emit('room-signal', {
            from: client.id,
            fromName: fromUser?.name || '未知用户',
            signal: payload.signal,
        });
    }
    broadcastRoomList() {
        const roomList = Array.from(this.rooms.entries()).map(([id, members]) => ({
            id,
            name: this.roomMetadata.get(id)?.name || '未知房间',
            memberCount: members.size
        }));
        this.server.emit('room-list', roomList);
    }
    getOnlineUsers() {
        return Object.fromEntries(this.users);
    }
    broadcastUserList() {
        const userList = Array.from(this.users.entries()).map(([id, info]) => ({
            id,
            name: info.name,
            isBusy: info.isBusy,
        }));
        this.server.emit('user-list', userList);
    }
};
exports.SignalingGateway = SignalingGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], SignalingGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('register'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, String]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleRegister", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('offer'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleOffer", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('answer'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleAnswer", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('ice-candidate'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleIceCandidate", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('hangup'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleHangup", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('create-room'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, String]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleCreateRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('join-room'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, String]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleJoinRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('leave-room'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleLeaveRoom", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('room-signal'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], SignalingGateway.prototype, "handleRoomSignal", null);
exports.SignalingGateway = SignalingGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: { origin: '*' },
    })
], SignalingGateway);
//# sourceMappingURL=signaling.gateway.js.map