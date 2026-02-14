import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { ChatMessage } from '../game.types';

export type ChatDocument = Chat & Document;

@Schema({ collection: 'chat' })
export class Chat {
  @Prop({ required: true, unique: true, default: 'global' })
  id: string;

  @Prop({ type: [Object], default: [] })
  messages: ChatMessage[];
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
