import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { CellColor, CellPosition } from '../game.types';

export type CellDocument = Cell & Document;

@Schema({ collection: 'cells' })
export class Cell {
  @Prop({ required: true, unique: true })
  key: string; // "x:y"

  @Prop({ type: Object, required: true })
  position: CellPosition;

  @Prop({ required: true })
  color: CellColor;

  @Prop({ type: Number, required: false })
  health?: number;

  @Prop({ type: Object, default: {} })
  playerProgress: Record<string, number>; // playerId -> progress

  // Параметры клетки
  @Prop({ type: Number, required: false })
  food?: number; // Кол-во еды (0-255, шаг 8)

  @Prop({ type: Number, required: false })
  building?: number; // Кол-во строительных единиц (0-255, шаг 8)

  @Prop({ type: Number, required: false })
  experience?: number; // Кол-во опыта (0-255, шаг 8)

  @Prop({ type: Number, required: false })
  power?: number; // Сила клетки (1-256, влияет на яркость)
}

export const CellSchema = SchemaFactory.createForClass(Cell);
CellSchema.index({ key: 1 }, { unique: true });
