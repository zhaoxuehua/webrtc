import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnModuleInit } from '@nestjs/common';
export interface UserInfo {
    name: string;
    isBusy: boolean;
    peerId?: string;
    roomId?: string;
}
export declare class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
    server: Server;
    private users;
    private rooms;
    private roomMetadata;
    onModuleInit(): void;
    handleConnection(client: Socket): void;
    handleDisconnect(client: Socket): void;
    handleRegister(client: Socket, userName: string): void;
    handleOffer(client: Socket, payload: {
        to: string;
        offer: any;
        fromName: string;
    }): void;
    handleAnswer(client: Socket, payload: {
        to: string;
        answer: any;
        fromName: string;
    }): void;
    handleIceCandidate(client: Socket, payload: {
        to: string;
        candidate: any;
    }): void;
    handleHangup(client: Socket, payload: {
        to: string;
    }): void;
    handleCreateRoom(client: Socket, roomName: string): string;
    handleJoinRoom(client: Socket, roomId: string): void;
    handleLeaveRoom(client: Socket): void;
    handleRoomSignal(client: Socket, payload: {
        to: string;
        signal: any;
    }): void;
    private broadcastRoomList;
    getOnlineUsers(): {
        [k: string]: UserInfo;
    };
    private broadcastUserList;
}
