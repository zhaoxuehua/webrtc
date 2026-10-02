import { Controller, Get } from '@nestjs/common';
import { SignalingGateway } from './signaling/signaling.gateway';

@Controller()
export class AppController {
  constructor(private readonly signalingGateway: SignalingGateway) {}

  @Get('hello')
  getHello(): string {
    return 'Hello World!';
  }

  @Get('users-debug')
  getUsers() {
    return this.signalingGateway.getOnlineUsers();
  }
}
