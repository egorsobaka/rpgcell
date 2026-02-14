import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';
import { Player, PlayerSchema } from './schemas/player.schema';
import { Cell, CellSchema } from './schemas/cell.schema';
import { Chat, ChatSchema } from './schemas/chat.schema';
import { LocalChat, LocalChatSchema } from './schemas/local-chat.schema';
import { Building, BuildingSchema } from './schemas/building.schema';

@Module({
  imports: [
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://admin:password@localhost:27017/rpg_game?authSource=admin',
    ),
    MongooseModule.forFeature([
      { name: Player.name, schema: PlayerSchema },
      { name: Cell.name, schema: CellSchema },
      { name: Chat.name, schema: ChatSchema },
      { name: LocalChat.name, schema: LocalChatSchema },
      { name: Building.name, schema: BuildingSchema },
    ]),
  ],
  controllers: [AppController],
  providers: [AppService, GameGateway, GameService],
})
export class AppModule {}
