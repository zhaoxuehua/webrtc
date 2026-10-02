class WebrtcSDK {
    constructor(serverUrl) {
        this.socket = io(serverUrl);
        this.rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        
        this.state = {
            myName: '',
            localStream: null,
            pc: null,
            targetId: null,
            pendingOffer: null,
            pendingFrom: null,
            pendingFromName: null,
            pendingCandidates: [],
            currentRoom: null,
            meetingPeers: {},
            peerNames: {},
            roomCandidatesQueue: {}
        };

        this.events = {
            onUserList: (users) => {},
            onRoomList: (rooms) => {},
            onIncomingCall: (from, fromName) => {},
            onCallAnswered: () => {},
            onCallEnded: () => {},
            onBusySignal: (name) => {},
            onLocalStream: (stream, hasVideo, hasAudio) => {},
            onRoomInfo: (info) => {},
            onTrackAdded: (peerId, stream, name) => {},
            onPeerLeft: (peerId) => {}
        };

        this._setupSocket();
    }

    on(event, callback) {
        if (this.events.hasOwnProperty(event)) {
            this.events[event] = callback;
        }
    }

    register(name) {
        this.state.myName = name;
        this.socket.emit('register', name);
    }

    async getMedia() {
        if (this.state.localStream) {
            this._notifyLocalStream();
            return this.state.localStream;
        }
        try {
            console.log('[SDK] 正在请求音视频权限...');
            this.state.localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
        } catch (e) {
            console.warn('[SDK] 尝试获取视频失败，原因:', e.name, e.message);
            console.log('[SDK] 尝试降级到纯音频模式...');
            try {
                this.state.localStream = await navigator.mediaDevices.getUserMedia({video: false, audio: true});
            } catch (e2) {
                console.error('[SDK] 最终获取音频也失败:', e2.name, e2.message);
                this.state.localStream = null;
            }
        }
        this._notifyLocalStream();
        return this.state.localStream;
    }

    _notifyLocalStream() {
        if (this.state.localStream) {
            const hasVideo = this.state.localStream.getVideoTracks().length > 0;
            const hasAudio = this.state.localStream.getAudioTracks().length > 0;
            this.events.onLocalStream(this.state.localStream, hasVideo, hasAudio);
        } else {
            this.events.onLocalStream(null, false, false);
        }
    }

    // --- 1v1 Call Methods ---

    async callUser(id, name) {
        // 尝试获取媒体，但不强制要求
        await this.getMedia().catch(e => console.warn('[SDK] 无本地媒体，将以仅接收模式呼叫'));
        
        this.state.targetId = id;
        this.state.pc = this._createPC(id, name);
        const offer = await this.state.pc.createOffer();
        await this.state.pc.setLocalDescription(offer);
        this.socket.emit('offer', { to: id, offer, fromName: this.state.myName });
    }

    async acceptCall() {
        // 尝试获取媒体，但不强制要求
        await this.getMedia().catch(e => console.warn('[SDK] 无本地媒体，将以仅接收模式接听'));
        
        if (!this.state.pendingOffer) return;
        this.state.targetId = this.state.pendingFrom;
        this.state.pc = this._createPC(this.state.pendingFrom, this.state.pendingFromName);
        await this.state.pc.setRemoteDescription(new RTCSessionDescription(this.state.pendingOffer));
        
        this.state.pendingCandidates.forEach(c => this.state.pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => {}));
        this.state.pendingCandidates = [];

        const answer = await this.state.pc.createAnswer();
        await this.state.pc.setLocalDescription(answer);
        this.socket.emit('answer', { to: this.state.pendingFrom, answer, fromName: this.state.myName });
    }

    declineCall() {
        this.socket.emit('hangup', { to: this.state.pendingFrom });
        this._reset1v1();
    }

    hangup() {
        if (this.state.targetId) this.socket.emit('hangup', { to: this.state.targetId });
        this._reset1v1();
    }

    _reset1v1() {
        if (this.state.pc) { this.state.pc.close(); this.state.pc = null; }
        this.state.targetId = null;
        this.state.pendingOffer = null;
        this.state.pendingCandidates = [];
        if (this.state.localStream && !this.state.currentRoom) { 
            this.state.localStream.getTracks().forEach(t => t.stop()); 
            this.state.localStream = null; 
        }
        this.events.onCallEnded();
    }

    _createPC(tid, tname) {
        const pc = new RTCPeerConnection(this.rtcConfig);
        this._setupReconnection(pc, tid, tname);
        
        if (this.state.localStream) {
            this.state.localStream.getTracks().forEach(t => pc.addTrack(t, this.state.localStream));
        }
        
        const hasVideo = this.state.localStream && this.state.localStream.getVideoTracks().length > 0;
        const hasAudio = this.state.localStream && this.state.localStream.getAudioTracks().length > 0;
        if (!hasVideo) pc.addTransceiver('video', { direction: 'recvonly' });
        if (!hasAudio) pc.addTransceiver('audio', { direction: 'recvonly' });

        pc.onicecandidate = e => { if (e.candidate) this.socket.emit('ice-candidate', { to: tid, candidate: e.candidate }); };
        pc.ontrack = e => this.events.onTrackAdded('remote', e.streams[0], tname); // 'remote' id for 1v1
        return pc;
    }

    // --- Meeting Methods ---

    createRoom(name) {
        this.socket.emit('create-room', name, (roomId) => {
            this.joinRoom(roomId);
        });
    }

    async joinRoom(roomId) {
        this.state.currentRoom = roomId;
        await this.getMedia();
        this.socket.emit('join-room', roomId);
    }

    leaveRoom() {
        this.socket.emit('leave-room');
        this.state.currentRoom = null;
        Object.values(this.state.meetingPeers).forEach(pc => pc.close());
        this.state.meetingPeers = {};
        
        if (this.state.localStream) { 
            this.state.localStream.getTracks().forEach(t => t.stop()); 
            this.state.localStream = null; 
        }
    }

    _createMeetingPC(targetId, targetName, isOfferer) {
        const pc = new RTCPeerConnection(this.rtcConfig);
        this._setupReconnection(pc, targetId, targetName, isOfferer);

        // 必须先挂载协商监听，再添加轨道，否则会错过最初的协商事件。
        // 为了防止双向同时发起 Offer 导致“打架”(Glare)，我们用 Socket ID 进行简单排序。
        pc.onnegotiationneeded = async () => {
            // 只有当自己 ID 比对方大，或者我是原始发起者，或者对方 ID 不存在时，才由我发起
            // 这是一个简单的竞态裁决逻辑
            const myId = this.socket.id;
            const canInitiate = isOfferer || (myId > targetId);

            if (!canInitiate) {
                console.log(`[信令] [${targetName}] 触发协商，等待对方发起...`);
                return;
            }

            try {
                if (pc.signalingState !== 'stable') return;
                console.log(`[信令] 正在向人员 [${targetName}] 发起协商更新...`);
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                this.socket.emit('room-signal', { to: targetId, signal: offer });
            } catch (err) { console.error(`[信令异常] 与 [${targetName}] 协商失败:`, err); }
        };

        if (this.state.localStream) {
            this.state.localStream.getTracks().forEach(track => pc.addTrack(track, this.state.localStream));
        }
        
        const hasVideo = this.state.localStream && this.state.localStream.getVideoTracks().length > 0;
        const hasAudio = this.state.localStream && this.state.localStream.getAudioTracks().length > 0;
        if (!hasVideo) pc.addTransceiver('video', { direction: 'recvonly' });
        if (!hasAudio) pc.addTransceiver('audio', { direction: 'recvonly' });

        pc.onicecandidate = (e) => {
            if (e.candidate) this.socket.emit('room-signal', { to: targetId, signal: e.candidate });
        };

        pc.ontrack = (e) => {
            const stream = e.streams[0] || new MediaStream([e.track]);
            const latestName = this.state.peerNames[targetId] || targetName;
            this.events.onTrackAdded(targetId, stream, latestName);
        };

        return pc;
    }

    // --- Device Controls ---

    toggleMic() {
        if (this.state.localStream) {
            const track = this.state.localStream.getAudioTracks()[0];
            if (track) {
                track.enabled = !track.enabled;
                return track.enabled;
            }
        }
        return null;
    }

    toggleVideo() {
        if (this.state.localStream) {
            const track = this.state.localStream.getVideoTracks()[0];
            if (track) {
                track.enabled = !track.enabled;
                return track.enabled;
            }
        }
        return null;
    }

    // --- Internals ---

    _setupReconnection(pc, tid, tname, isOfferer) {
        let isReconnecting = false;
        
        const tryRestart = async () => {
            if (isReconnecting || !isOfferer || !this.state.currentRoom) return;
            
            isReconnecting = true;
            console.log(`[WebRTC] 连接到 ${tname} 的 ICE 异常 (${pc.iceConnectionState})，发起 ICE Restart...`);
            
            try {
                // 某些高级浏览器支持显式 restartIce()，否则通过 offer(iceRestart: true) 触发
                if (typeof pc.restartIce === 'function') pc.restartIce();
                
                const offer = await pc.createOffer({ iceRestart: true });
                await pc.setLocalDescription(offer);
                this.socket.emit('room-signal', { to: tid, signal: offer });
            } catch (e) {
                console.error(`[信令异常] 人员 [${tname}] ICE Restart 失败:`, e.name, e.message);
            }
            
            // 冷却时间，防止短时间重复尝试
            setTimeout(() => { isReconnecting = false; }, 3000);
        };

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                tryRestart();
            }
        };

        // 现代标准：connectionState 是比 iceConnectionState 更综合的状态
        if ('onconnectionstatechange' in pc) {
            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                    tryRestart();
                }
            };
        }
    }

    _setupSocket() {
        this.socket.on('user-list', users => this.events.onUserList(users));
        this.socket.on('room-list', rooms => this.events.onRoomList(rooms));
        
        this.socket.on('offer', ({ from, fromName, offer }) => {
            if (this.state.currentRoom) return; // Ignore 1v1 if in room
            this.state.pendingOffer = offer;
            this.state.pendingFrom = from;
            this.state.pendingFromName = fromName;
            this.events.onIncomingCall(from, fromName);
        });

        this.socket.on('answer', async ({ answer }) => {
            if (this.state.pc) {
                await this.state.pc.setRemoteDescription(new RTCSessionDescription(answer));
                this.events.onCallAnswered();
                this.state.pendingCandidates.forEach(c => this.state.pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => {}));
                this.state.pendingCandidates = [];
            }
        });

        this.socket.on('ice-candidate', ({ from, candidate }) => {
            if (this.state.pc && from === this.state.targetId) {
                this.state.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
            } else if (!this.state.pc && from === this.state.pendingFrom) {
                this.state.pendingCandidates.push(candidate);
            }
        });

        this.socket.on('hangup', () => this._reset1v1());
        this.socket.on('peer-hungup', () => this._reset1v1());
        
        this.socket.on('busy-signal', ({ name }) => {
            this._reset1v1();
            this.events.onBusySignal(name);
        });

        // Room Signal Handling
        this.socket.on('room-info', (info) => {
            if (info.members) {
                info.members.forEach(m => {
                    if (m.id !== this.socket.id) {
                        this.state.peerNames[m.id] = m.name;
                        this.events.onTrackAdded(m.id, null, m.name); // Create placeholder
                    }
                });
            }
            this.events.onRoomInfo(info);
        });

        this.socket.on('user-joined-room', async ({ id, name }) => {
            this.state.peerNames[id] = name;
            this.events.onTrackAdded(id, null, name); // Placehold
            const pc = this._createMeetingPC(id, name, true);
            this.state.meetingPeers[id] = pc;
        });

        this.socket.on('room-signal', async ({ from, fromName, signal }) => {
            let pc = this.state.meetingPeers[from];
            
            if (fromName && fromName !== '加载中...') {
                this.state.peerNames[from] = fromName;
                this.events.onTrackAdded(from, null, fromName); // Updates name tag if placeholder exists
            }

            if (signal.type === 'offer') {
                if (!pc) {
                    pc = this._createMeetingPC(from, fromName || '加载中...', false);
                    this.state.meetingPeers[from] = pc;
                    this.events.onTrackAdded(from, null, fromName || '加载中...');
                }
                await pc.setRemoteDescription(new RTCSessionDescription(signal));
                
                // 处理积压的候选者
                if (this.state.roomCandidatesQueue[from]) {
                    for (const c of this.state.roomCandidatesQueue[from]) {
                        await pc.addIceCandidate(c).catch(e=>{});
                    }
                    delete this.state.roomCandidatesQueue[from];
                }

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                this.socket.emit('room-signal', { to: from, signal: answer });
            } else if (signal.type === 'answer') {
                if (pc) {
                    await pc.setRemoteDescription(new RTCSessionDescription(signal));
                    if (this.state.roomCandidatesQueue[from]) {
                        for (const c of this.state.roomCandidatesQueue[from]) {
                            await pc.addIceCandidate(c).catch(e=>{});
                        }
                        delete this.state.roomCandidatesQueue[from];
                    }
                }
            } else if (signal.candidate) {
                const cand = new RTCIceCandidate(signal);
                if (pc && pc.remoteDescription) {
                    await pc.addIceCandidate(cand).catch(e=>{});
                } else {
                    if (!this.state.roomCandidatesQueue[from]) this.state.roomCandidatesQueue[from] = [];
                    this.state.roomCandidatesQueue[from].push(cand);
                }
            }
        });

        this.socket.on('user-left-room', ({ id }) => {
            if (this.state.meetingPeers[id]) {
                this.state.meetingPeers[id].close();
                delete this.state.meetingPeers[id];
            }
            this.events.onPeerLeft(id);
        });
    }
}
// Exporting to window
window.WebrtcSDK = WebrtcSDK;
