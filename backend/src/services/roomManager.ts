class RoomManager {
	private rooms: Map<string, Set<string>> = new Map();
	private connectionRooms: Map<string, Set<string>> = new Map();

	join(connectionId: string, roomName: string): void {
		if (!this.rooms.has(roomName)) {
			this.rooms.set(roomName, new Set());
		}
		this.rooms.get(roomName)!.add(connectionId);

		if (!this.connectionRooms.has(connectionId)) {
			this.connectionRooms.set(connectionId, new Set());
		}
		this.connectionRooms.get(connectionId)!.add(roomName);
	}

	leave(connectionId: string, roomName: string): void {
		const room = this.rooms.get(roomName);
		if (room) {
			room.delete(connectionId);
			if (room.size === 0) {
				this.rooms.delete(roomName);
			}
		}

		const rooms = this.connectionRooms.get(connectionId);
		if (rooms) {
			rooms.delete(roomName);
			if (rooms.size === 0) {
				this.connectionRooms.delete(connectionId);
			}
		}
	}

	leaveAll(connectionId: string): void {
		const rooms = this.connectionRooms.get(connectionId);
		if (rooms) {
			// 複製一份房間列表，避免在迭代時修改
			const roomsCopy = Array.from(rooms);
			for (const roomName of roomsCopy) {
				this.leave(connectionId, roomName);
			}
		}
	}

	getMembers(roomName: string): string[] {
		const room = this.rooms.get(roomName);
		return room ? Array.from(room) : [];
	}
}

export const roomManager = new RoomManager();
