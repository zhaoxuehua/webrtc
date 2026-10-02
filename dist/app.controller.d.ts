import { SignalingGateway } from './signaling/signaling.gateway';
export declare class AppController {
    private readonly signalingGateway;
    constructor(signalingGateway: SignalingGateway);
    getHello(): string;
    getUsers(): {
        [k: string]: import("./signaling/signaling.gateway").UserInfo;
    };
}
