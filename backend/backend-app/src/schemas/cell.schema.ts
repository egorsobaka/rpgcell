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

  @Prop({ type: Number, required: false, default: 0 })
  constructionPoints?: number; // Очки строительства (чем больше, тем темнее клетка)

  @Prop({ type: Number, required: false })
  constructionType?: number; // Тип строительного материала (еда / 32)

  @Prop({ type: String, required: false })
  buildingName?: string; // Название постройки, если клетка является частью постройки

  @Prop({ type: String, required: false })
  buildingId?: string; // ID постройки (для группировки клеток одной постройки)

  @Prop({ type: String, required: false })
  name?: string; // Название ресурса на основе пропорций параметров
}

export const CellSchema = SchemaFactory.createForClass(Cell);
CellSchema.index({ key: 1 }, { unique: true });
