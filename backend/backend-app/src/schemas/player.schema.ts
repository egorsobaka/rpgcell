import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { CellPosition, PlayerState } from '../game.types';

export type PlayerDocument = Player & Document;

@Schema({ collection: 'players' })
export class Player {
  @Prop({ required: true, unique: true })
  id: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: Object, required: true })
  position: CellPosition;

  @Prop({ type: [String], default: [] })
  unlockedColors: string[];

  @Prop({ type: Object, default: {} })
  inventory: Record<string, number>;

  @Prop({ default: 0 })
  totalCollected: number;

  @Prop({ type: Object, default: {} })
  colorLevels: Record<string, number>;

  @Prop({ default: 255 })
  satiety: number;

  @Prop({ default: 255 })
  weight: number;

  @Prop({ default: 1 })
  stamina: number;

  @Prop({ default: 1 })
  collectionPower: number;

  @Prop({ default: 0 })
  experience: number;

  @Prop({ default: 1 })
  power: number;

  @Prop({ default: 1 })
  level: number;

  @Prop({ default: 0 })
  availableUpgrades: number;

  // Дополнительные параметры
  @Prop({ default: 100 })
  health: number;

  @Prop({ default: 100 })
  maxHealth: number;

  @Prop({ default: 0 })
  defense: number;

  @Prop({ default: 0 })
  luck: number;

  @Prop({ default: 0 })
  regeneration: number;

  // Время создания игрока (для расчета длительности игры)
  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  // Построенные постройки: название -> количество
  @Prop({ type: Object, default: {} })
  buildings: Record<string, number>;

  // Общее количество съеденной еды (для расчета увеличения веса)
  @Prop({ default: 0 })
  totalFoodEaten: number;

  // ID пользователя (для привязки нескольких персонажей к одному пользователю)
  @Prop({ required: false, index: true })
  userId?: string;
}

export const PlayerSchema = SchemaFactory.createForClass(Player);
