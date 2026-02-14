// Вспомогательные методы для работы с MongoDB
// Этот файл содержит методы, которые будут интегрированы в game.service.ts

import { Model } from 'mongoose';
import { PlayerDocument } from './schemas/player.schema';
import { CellDocument } from './schemas/cell.schema';
import { ChatDocument } from './schemas/chat.schema';
import { LocalChatDocument } from './schemas/local-chat.schema';
import { PlayerState, CellPosition, CellColor, ChatMessage, LocalChat, LocalChatMessage } from './game.types';

export class GameServiceMongoHelpers {
  static async getOrCreatePlayer(
    clientId: string,
    playerModel: Model<PlayerDocument>,
    localChatModel: Model<LocalChatDocument>,
  ): Promise<PlayerState> {
    let player = await playerModel.findOne({ id: clientId }).lean().exec();
    
    if (!player) {
      const newPlayer = new playerModel({
        id: clientId,
        name: `Player-${clientId.slice(0, 4)}`,
        position: { x: 0, y: 0 },
        unlockedColors: [],
        inventory: {},
        totalCollected: 0,
        colorLevels: {},
        satiety: 255,
        weight: 255,
        stamina: 1,
        collectionPower: 10,
        experience: 0,
        power: 1,
        level: 1,
        availableUpgrades: 0,
        health: 100,
        maxHealth: 100,
        defense: 0,
        luck: 0,
        regeneration: 0,
      });
      await newPlayer.save();
      player = newPlayer.toObject();
      
      // Добавляем игрока в чат его начальной позиции
      const key = `${player.position.x}:${player.position.y}`;
      await localChatModel.findOneAndUpdate(
        { key },
        {
          $setOnInsert: {
            key,
            cellPosition: player.position,
            participants: [],
            messages: [],
          },
        },
        { upsert: true, new: true },
      );
      await localChatModel.updateOne(
        { key },
        { $addToSet: { participants: clientId } },
      );
    }
    
    return this.playerToState(player);
  }

  static playerToState(player: any): PlayerState {
    return {
      id: player.id,
      name: player.name,
      position: player.position,
      unlockedColors: player.unlockedColors || [],
      inventory: player.inventory || {},
      totalCollected: player.totalCollected || 0,
      colorLevels: player.colorLevels || {},
      satiety: player.satiety || 255,
      weight: player.weight || 255,
      stamina: player.stamina || 1,
      collectionPower: player.collectionPower || 10,
      experience: player.experience || 0,
      power: player.power || 1,
      level: player.level || 1,
      availableUpgrades: player.availableUpgrades || 0,
      health: player.health ?? 100,
      maxHealth: player.maxHealth ?? 100,
      defense: player.defense ?? 0,
      luck: player.luck ?? 0,
      regeneration: player.regeneration ?? 0,
    };
  }

  static async savePlayer(
    playerState: PlayerState,
    playerModel: Model<PlayerDocument>,
  ): Promise<void> {
    await playerModel.findOneAndUpdate(
      { id: playerState.id },
      {
        $set: {
          name: playerState.name,
          position: playerState.position,
          unlockedColors: playerState.unlockedColors,
          inventory: playerState.inventory,
          totalCollected: playerState.totalCollected,
          colorLevels: playerState.colorLevels,
          satiety: playerState.satiety,
          weight: playerState.weight,
          stamina: playerState.stamina,
          collectionPower: playerState.collectionPower,
          experience: playerState.experience,
          power: playerState.power,
          level: playerState.level,
          availableUpgrades: playerState.availableUpgrades,
          health: playerState.health,
          maxHealth: playerState.maxHealth,
          defense: playerState.defense,
          luck: playerState.luck,
          regeneration: playerState.regeneration,
        },
      },
      { upsert: true },
    );
  }

  static async getOrCreateCell(
    key: string,
    position: CellPosition,
    defaultColor: CellColor,
    cellModel: Model<CellDocument>,
  ): Promise<CellDocument> {
    let cell = await cellModel.findOne({ key }).exec();
    
    if (!cell) {
      cell = new cellModel({
        key,
        position,
        color: defaultColor,
        health: null,
        playerProgress: {},
      });
      await cell.save();
    }
    
    return cell;
  }

  static async getCell(
    key: string,
    cellModel: Model<CellDocument>,
  ): Promise<CellDocument | null> {
    return cellModel.findOne({ key }).exec();
  }

  static async saveCell(
    cell: CellDocument,
  ): Promise<void> {
    await cell.save();
  }

  static async getOrCreateChat(
    chatModel: Model<ChatDocument>,
  ): Promise<ChatDocument> {
    let chat = await chatModel.findOne({ id: 'global' }).exec();
    
    if (!chat) {
      chat = new chatModel({
        id: 'global',
        messages: [],
      });
      await chat.save();
    }
    
    return chat;
  }

  static async getOrCreateLocalChat(
    key: string,
    cellPosition: CellPosition,
    localChatModel: Model<LocalChatDocument>,
  ): Promise<LocalChatDocument> {
    let localChat = await localChatModel.findOne({ key }).exec();
    
    if (!localChat) {
      localChat = new localChatModel({
        key,
        cellPosition,
        participants: [],
        messages: [],
      });
      await localChat.save();
    }
    
    return localChat;
  }

  static async getAllPlayers(
    playerModel: Model<PlayerDocument>,
  ): Promise<PlayerState[]> {
    const players = await playerModel.find().lean().exec();
    return players.map(p => this.playerToState(p));
  }
}
