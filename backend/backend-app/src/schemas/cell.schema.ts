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
}

export const CellSchema = SchemaFactory.createForClass(Cell);
CellSchema.index({ key: 1 }, { unique: true });
