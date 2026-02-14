import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import type { CellPosition, LocalChatMessage } from '../game.types';

export type LocalChatDocument = LocalChat & Document;

@Schema({ collection: 'local_chats' })
export class LocalChat {
  @Prop({ required: true, unique: true })
  key: string; // "x:y"

  @Prop({ type: Object, required: true })
  cellPosition: CellPosition;

  @Prop({ type: [String], default: [] })
  participants: string[];

  @Prop({ type: [Object], default: [] })
  messages: LocalChatMessage[];
}

export const LocalChatSchema = SchemaFactory.createForClass(LocalChat);
LocalChatSchema.index({ key: 1 }, { unique: true });
