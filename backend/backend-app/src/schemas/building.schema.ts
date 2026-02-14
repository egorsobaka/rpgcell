import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface BuildingStructure {
  x: number; // Относительная координата X
  y: number; // Относительная координата Y
  a: number; // Минимальное количество строительных очков
  t: number[]; // Массив типов строительного материала
}

export type BuildingDocument = Building & Document;

@Schema({ collection: 'buildings' })
export class Building {
  @Prop({ required: true, unique: true })
  name: string; // Название постройки

  @Prop({ type: [Object], required: true })
  structure: BuildingStructure[]; // Структура постройки

  @Prop({ required: true })
  cellPower: number; // Сила клетки

  @Prop({ required: true })
  cellHealth: number; // Жизни клетки
}

export const BuildingSchema = SchemaFactory.createForClass(Building);
BuildingSchema.index({ name: 1 }, { unique: true });
