import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { CellPosition, PlayerState } from './game.types';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(GameGateway.name);
  
  // Маппинг socket.id -> playerId для восстановления сессий
  private socketToPlayerId = new Map<string, string>();
  // Множество онлайн игроков (playerId)
  private onlinePlayers = new Set<string>();

  constructor(private readonly gameService: GameService) {}
  
  // Получить playerId для socket
  private getPlayerId(socket: Socket): string {
    // Если маппинг еще не установлен, устанавливаем его (для новых подключений)
    if (!this.socketToPlayerId.has(socket.id)) {
      this.socketToPlayerId.set(socket.id, socket.id);
    }
    return this.socketToPlayerId.get(socket.id) || socket.id;
  }

  async handleConnection(client: Socket): Promise<void> {
    this.logger.log(`Client connected: ${client.id}`);
    
    // Проверяем, есть ли playerId в auth данных (отправляется при подключении)
    const authData = (client.handshake as any).auth;
    const authPlayerId = authData?.playerId;
    
    // Временно устанавливаем маппинг на socket.id, чтобы движение работало сразу
    // Если придет player:restore, маппинг будет обновлен
    this.socketToPlayerId.set(client.id, client.id);
    
    let connectionHandled = false;
    
    // Если есть playerId в auth, сразу пытаемся восстановить игрока
    if (authPlayerId) {
      this.logger.log(`Found playerId in auth: ${authPlayerId}, attempting to restore`);
      const existingPlayer = await this.gameService.getPlayerById(authPlayerId);
      if (existingPlayer) {
        this.logger.log(`Restoring existing player from auth: ${authPlayerId}`);
        connectionHandled = true;
        this.socketToPlayerId.set(client.id, authPlayerId);
        this.onlinePlayers.add(authPlayerId);
        await this.sendInitialState(client, existingPlayer);
        // Регистрируем обработчик для обновлений при переподключении
        client.on('player:restore', async (data: { playerId: string }) => {
          if (data.playerId === authPlayerId) {
            const player = await this.gameService.getPlayerById(data.playerId);
            if (player) {
              await this.sendInitialState(client, player);
            }
          }
        });
        return; // Выходим, не создаем нового игрока и не устанавливаем таймаут
      } else {
        this.logger.warn(`Player with ID ${authPlayerId} from auth not found in database`);
      }
    }
    
    // Обработчик для восстановления игрока по сохраненному ID
    // Используем 'on' вместо 'once', чтобы обработать событие даже при переподключении
    client.on('player:restore', async (data: { playerId: string }) => {
      this.logger.log(`Received player:restore for playerId: ${data.playerId}, socket: ${client.id}, connectionHandled: ${connectionHandled}`);
      
      // Если уже обработано, игнорируем повторные запросы
      if (connectionHandled) {
        // Но если это переподключение с тем же playerId, обновляем состояние
        const currentPlayerId = this.socketToPlayerId.get(client.id);
        if (currentPlayerId === data.playerId) {
          this.logger.log(`Updating state for existing player: ${data.playerId}`);
          const existingPlayer = await this.gameService.getPlayerById(data.playerId);
          if (existingPlayer) {
            await this.sendInitialState(client, existingPlayer);
          }
        }
        return;
      }
      connectionHandled = true;
      
      const existingPlayer = await this.gameService.getPlayerById(data.playerId);
      if (existingPlayer) {
        this.logger.log(`Restoring existing player: ${data.playerId}`);
        // Обновляем маппинг socket.id -> playerId
        this.socketToPlayerId.set(client.id, data.playerId);
        // Добавляем игрока в список онлайн
        this.onlinePlayers.add(data.playerId);
        await this.sendInitialState(client, existingPlayer);
      } else {
        // Если игрок не найден, НЕ создаем нового - ждем, пока пользователь перезагрузит страницу
        // или используем сохраненный playerId для создания нового игрока с этим ID
        this.logger.warn(`Player with ID ${data.playerId} not found, but playerId was provided. Creating new player with this ID.`);
        const newPlayer = await this.gameService.getOrCreatePlayer(data.playerId);
        // Обновляем маппинг socket.id -> playerId
        this.socketToPlayerId.set(client.id, data.playerId);
        // Добавляем игрока в список онлайн
        this.onlinePlayers.add(data.playerId);
        await this.sendInitialState(client, newPlayer);
      }
    });
    
    // Если не было события восстановления в течение 3000ms, создаем нового игрока с новым UUID
    // Увеличиваем таймаут, чтобы дать время для отправки player:restore (особенно при перезагрузке страницы)
    setTimeout(async () => {
      if (connectionHandled) return;
      connectionHandled = true;
      
      this.logger.warn(`No player:restore event received for socket ${client.id} within timeout. Creating new player.`);
      // Создаем нового игрока с новым UUID (не client.id)
      const newPlayer = await this.gameService.createNewPlayer();
      // Обновляем маппинг socket.id -> playerId
      this.socketToPlayerId.set(client.id, newPlayer.id);
      // Добавляем игрока в список онлайн
      this.onlinePlayers.add(newPlayer.id);
      await this.sendInitialState(client, newPlayer);
    }, 3000);
  }

  private async sendInitialState(client: Socket, player: PlayerState): Promise<void> {
    const [players, leaderboard, chat, cells] = await Promise.all([
      this.gameService.getPlayers(),
      this.gameService.getLeaderboard(this.onlinePlayers),
      this.gameService.getRecentMessages(),
      this.gameService.getViewportColors(player.position, 8),
    ]);
    client.emit('state:init', {
      player,
      players,
      leaderboard,
      chat,
    });
    client.emit('cells:viewport', {
      center: player.position,
      radius: 8,
      cells,
    });
    
    // Отправляем информацию о личном чате, если есть
    const localChat = await this.gameService.getLocalChat(player.position);
    if (localChat) {
      const participants = await this.gameService.getLocalChatParticipants(player.position);
      const allPlayers = await this.gameService.getPlayers();
      client.emit('local:chat:update', {
        cellPosition: player.position,
        participants: participants.map((id: string) => {
          const p = allPlayers.find((pl: PlayerState) => pl.id === id);
          return p ? { id: p.id, name: p.name } : null;
        }).filter(Boolean),
        messages: localChat.messages.slice(-20),
      });
    }
    
    await this.broadcastPlayers();
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.logger.log(`Client disconnected: ${client.id}`);
    const playerId = this.getPlayerId(client);
    
    // Удаляем игрока из списка онлайн
    this.onlinePlayers.delete(playerId);
    
    const allPlayers = await this.gameService.getPlayers();
    const player = allPlayers.find(p => p.id === playerId);
    
    // Удаляем игрока из личного чата
    if (player) {
      const chat = await this.gameService.getLocalChat(player.position);
      if (chat) {
        // Уведомляем остальных участников перед удалением
        for (const participantId of chat.participants) {
          if (participantId !== playerId) {
            const participantSocket = this.server.sockets.sockets.get(participantId);
            if (participantSocket) {
              const updatedParticipants = chat.participants.filter(id => id !== playerId);
              const updatedAllPlayers = await this.gameService.getPlayers();
              participantSocket.emit('local:chat:update', {
                cellPosition: player.position,
                participants: updatedParticipants.map(id => {
                  const p = updatedAllPlayers.find(pl => pl.id === id);
                  return p ? { id: p.id, name: p.name } : null;
                }).filter(Boolean),
                messages: chat.messages.slice(-20),
              });
            }
          }
        }
      }
      await this.gameService.removePlayerFromLocalChat(playerId, player.position);
    }
    
    // Удаляем маппинг при отключении
    this.socketToPlayerId.delete(client.id);
    // Не удаляем игрока из базы, чтобы сохранить прогресс
    // await this.gameService.removePlayer(playerId);
    await this.broadcastPlayers();
  }

  @SubscribeMessage('player:move')
  async handleMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { position: CellPosition },
  ): Promise<void> {
    const playerId = this.getPlayerId(client);
    const player = await this.gameService.movePlayer(playerId, body.position);
    if (!player) return;

    // Автосбор убран - теперь только через тапы

    const cells = await this.gameService.getViewportColors(player.position, 8);
    client.emit('cells:viewport', {
      center: player.position,
      radius: 8,
      cells,
    });

    // Обновляем информацию о личном чате
    const [localChat, participants, allPlayers] = await Promise.all([
      this.gameService.getLocalChat(player.position),
      this.gameService.getLocalChatParticipants(player.position),
      this.gameService.getPlayers(),
    ]);
    
    // Отправляем обновление чата всем участникам на этой клетке (включая самого игрока)
    const key = `${player.position.x}:${player.position.y}`;
    if (localChat) {
      const chatUpdate = {
        cellPosition: player.position,
        participants: participants.map(id => {
          const p = allPlayers.find(pl => pl.id === id);
          return p ? { id: p.id, name: p.name } : null;
        }).filter(Boolean),
        messages: localChat.messages.slice(-20), // Последние 20 сообщений
      };
      
      // Отправляем обновление всем участникам, включая самого игрока
      for (const participantId of participants) {
        // Находим socket по playerId через обратный маппинг
        let participantSocket: Socket | undefined;
        for (const [socketId, mappedPlayerId] of this.socketToPlayerId.entries()) {
          if (mappedPlayerId === participantId) {
            participantSocket = this.server.sockets.sockets.get(socketId);
            break;
          }
        }
        if (participantSocket) {
          participantSocket.emit('local:chat:update', chatUpdate);
        }
      }
      
      // Также отправляем обновление самому игроку, который переместился (на случай, если он еще не в списке участников)
      client.emit('local:chat:update', chatUpdate);
    } else {
      // Если чата нет, отправляем пустое обновление, чтобы очистить локальный чат на клиенте
      client.emit('local:chat:update', {
        cellPosition: player.position,
        participants: [],
        messages: [],
      });
    }

    // Важно: обновляем список игроков после движения, чтобы фронт получил новую позицию
    await this.broadcastPlayers();
  }

  @SubscribeMessage('cell:collect')
  async handleCollect(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { position: CellPosition },
  ): Promise<void> {
    const playerId = this.getPlayerId(client);
    const player = await this.gameService.collectCell(playerId, body.position);
    if (!player) return;
    const cellColor = await this.gameService.getCellColor(body.position);

    this.server.emit('cell:updated', {
      position: body.position,
      color: cellColor,
    });

    await this.broadcastPlayers();
    await this.broadcastLeaderboard();
  }

  @SubscribeMessage('color:cell:tap')
  async handleColorCellTap(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { position: CellPosition },
  ): Promise<void> {
    const playerId = this.getPlayerId(client);
    const result = await this.gameService.tapColorCell(playerId, body.position);

    // Отправляем прогресс и жизни всем клиентам
    this.server.emit('color:cell:progress', {
      position: body.position,
      progress: result.progress,
      required: result.required,
      color: result.color,
      health: result.health,
    });

    // Отправляем обновление жизней клетки всем клиентам
    this.server.emit('cell:health:update', {
      position: body.position,
      health: result.health,
    });

    // Если цвет собран - обновляем клетку и рассылаем обновления
    if (result.collected) {
      this.server.emit('cell:updated', {
        position: body.position,
        color: '#ffffff',
      });
      
      // Отправляем анимацию сбора ресурсов победителю
      if (result.winnerId && result.collectedAmount !== undefined) {
        // Находим socket по playerId через обратный маппинг
        let winnerSocket: Socket | undefined;
        for (const [socketId, mappedPlayerId] of this.socketToPlayerId.entries()) {
          if (mappedPlayerId === result.winnerId) {
            winnerSocket = this.server.sockets.sockets.get(socketId);
            break;
          }
        }
        if (winnerSocket) {
          winnerSocket.emit('resource:collected', {
            position: body.position,
            amount: result.collectedAmount,
            color: result.color,
          });
        } else {
          // Если socket не найден, отправляем событие текущему клиенту, если он победитель
          if (this.getPlayerId(client) === result.winnerId) {
            client.emit('resource:collected', {
              position: body.position,
              amount: result.collectedAmount,
              color: result.color,
            });
          }
        }
      }
      await this.broadcastPlayers();
      await this.broadcastLeaderboard();
    }
  }

  @SubscribeMessage('color:cell:progress:get')
  async handleColorCellProgressGet(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { position: CellPosition },
  ): Promise<void> {
    const playerId = this.getPlayerId(client);
    const progress = await this.gameService.getColorCellProgress(playerId, body.position);
    client.emit('color:cell:progress', {
      position: body.position,
      progress: progress.progress,
      required: progress.required,
      color: progress.color,
      health: progress.health,
    });
  }

  @SubscribeMessage('white:cell:tap')
  async handleWhiteCellTap(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { position: CellPosition },
  ): Promise<void> {
    const result = await this.gameService.tapWhiteCell(body.position);

    if (result.exploded) {
      // Отправляем обновления для всех затронутых клеток
      for (const cell of result.affectedCells) {
        this.server.emit('cell:updated', {
          position: cell.position,
          color: cell.color,
        });
      }
    }
  }

  @SubscribeMessage('chat:send')
  async handleChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { text: string },
  ): Promise<void> {
    if (!body.text?.trim()) return;
    const playerId = this.getPlayerId(client);
    const { message } = await this.gameService.addChatMessage(playerId, body.text.trim());
    this.server.emit('chat:new', message);
  }

  @SubscribeMessage('leaderboard:get')
  async handleLeaderboardRequest(@ConnectedSocket() client: Socket): Promise<void> {
    const leaderboard = await this.gameService.getLeaderboard();
    client.emit('leaderboard:update', leaderboard);
  }

  @SubscribeMessage('inventory:use')
  async handleUseInventoryItem(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { color: string; useType?: 'satiety' | 'experience' },
  ): Promise<void> {
    const useType = body.useType || 'satiety';
    const playerId = this.getPlayerId(client);
    
    // Сохраняем текущий уровень до использования предмета
    const playerBefore = await this.gameService.getPlayerById(playerId);
    const levelBefore = playerBefore?.level ?? 0;
    
    const result = await this.gameService.useInventoryItem(playerId, body.color, useType);
    if (result.success) {
      // Проверяем, изменился ли уровень (может измениться при использовании опыта)
      const playerAfter = await this.gameService.getPlayerById(playerId);
      const levelAfter = playerAfter?.level ?? 0;
      
      await this.broadcastPlayers();
      
      // Если уровень изменился, обновляем лидерборд
      if (levelAfter !== levelBefore) {
        await this.broadcastLeaderboard();
      }
    }
    // Отправляем результат клиенту
    client.emit('inventory:used', {
      success: result.success,
      satietyRestored: result.satietyRestored,
      newSatiety: result.newSatiety,
      experienceGained: result.experienceGained,
      newExperience: result.newExperience,
    });
  }

  private async broadcastPlayers(): Promise<void> {
    const players = await this.gameService.getPlayers();
    this.server.emit('players:update', players);
  }

  private async broadcastLeaderboard(): Promise<void> {
    const leaderboard = await this.gameService.getLeaderboard(this.onlinePlayers);
    this.server.emit('leaderboard:update', leaderboard);
  }

  @SubscribeMessage('player:attack')
  async handlePlayerAttack(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { targetId: string },
  ): Promise<void> {
    const playerId = this.getPlayerId(client);
    const result = await this.gameService.attackPlayer(playerId, body.targetId);
    if (result.success) {
      // Рассылаем обновление игроков всем клиентам
      await this.broadcastPlayers();
      
      // Отправляем результат атаки атакующему
      client.emit('player:attack:result', {
        success: true,
        damage: result.damage,
        targetSatiety: result.targetSatiety,
      });
    } else {
      client.emit('player:attack:result', {
        success: false,
        damage: 0,
        targetSatiety: 0,
      });
    }
  }

  @SubscribeMessage('local:chat:send')
  async handleLocalChatSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { text: string; position: CellPosition },
  ): Promise<void> {
    if (!body.text?.trim()) return;
    
    const playerId = this.getPlayerId(client);
    const result = await this.gameService.addLocalChatMessage(
      playerId,
      body.position,
      body.text.trim(),
    );

    if (result.success && result.message) {
      // Отправляем сообщение всем участникам чата на этой клетке
      const participants = await this.gameService.getLocalChatParticipants(body.position);
      for (const participantId of participants) {
        // Находим socket по playerId через обратный маппинг
        let participantSocket: Socket | undefined;
        for (const [socketId, mappedPlayerId] of this.socketToPlayerId.entries()) {
          if (mappedPlayerId === participantId) {
            participantSocket = this.server.sockets.sockets.get(socketId);
            break;
          }
        }
        if (participantSocket) {
          participantSocket.emit('local:chat:message', result.message);
        }
      }
    }
  }

  @SubscribeMessage('local:chat:get')
  async handleLocalChatGet(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { position: CellPosition },
  ): Promise<void> {
    const [localChat, participants, allPlayers] = await Promise.all([
      this.gameService.getLocalChat(body.position),
      this.gameService.getLocalChatParticipants(body.position),
      this.gameService.getPlayers(),
    ]);
    
    if (localChat) {
      client.emit('local:chat:update', {
        cellPosition: body.position,
        participants: participants.map((id: string) => {
          const p = allPlayers.find((pl: PlayerState) => pl.id === id);
          return p ? { id: p.id, name: p.name } : null;
        }).filter(Boolean),
        messages: localChat.messages.slice(-20),
      });
    } else {
      client.emit('local:chat:update', {
        cellPosition: body.position,
        participants: [],
        messages: [],
      });
    }
  }

  @SubscribeMessage('player:upgrade')
  async handlePlayerUpgrade(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { upgradeType: 'weight' | 'stamina' | 'collectionPower' | 'power' | 'maxHealth' | 'defense' | 'luck' | 'regeneration' },
  ): Promise<void> {
    const playerId = this.getPlayerId(client);
    
    // Сохраняем текущий уровень до улучшения
    const playerBefore = await this.gameService.getPlayerById(playerId);
    const levelBefore = playerBefore?.level ?? 0;
    
    const result = await this.gameService.applyUpgrade(playerId, body.upgradeType);
    if (result.success) {
      // Проверяем, изменился ли уровень (может измениться при использовании опыта)
      const playerAfter = await this.gameService.getPlayerById(playerId);
      const levelAfter = playerAfter?.level ?? 0;
      
      // Обновляем список игроков, чтобы все клиенты получили обновленное состояние
      await this.broadcastPlayers();
      
      // Если уровень изменился, обновляем лидерборд
      if (levelAfter !== levelBefore) {
        await this.broadcastLeaderboard();
      }
      
      // Отправляем результат клиенту
      client.emit('player:upgrade:result', { success: true });
    } else {
      client.emit('player:upgrade:result', { success: false, message: result.message });
    }
  }

  @SubscribeMessage('player:name:change')
  async handlePlayerNameChange(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { newName: string },
  ): Promise<void> {
    const playerId = this.getPlayerId(client);
    const result = await this.gameService.changePlayerName(playerId, body.newName);
    if (result.success) {
      // Обновляем список игроков, чтобы все клиенты получили обновленное состояние
      await this.broadcastPlayers();
      // Обновляем лидерборд для всех игроков (имя изменилось)
      await this.broadcastLeaderboard();
      // Отправляем результат клиенту
      client.emit('player:name:change:result', { success: true });
    } else {
      client.emit('player:name:change:result', { success: false, message: result.message });
    }
  }
}

