# Заметки по миграции на MongoDB

## Статус миграции

Частично выполнено:
- ✅ Созданы MongoDB схемы (Player, Cell, Chat, LocalChat)
- ✅ Добавлен Docker Compose с MongoDB
- ✅ Созданы Dockerfile для backend и frontend
- ✅ Обновлен AppModule для подключения MongoDB
- ✅ Частично переписаны методы GameService для работы с MongoDB:
  - ✅ `getOrCreatePlayer` - async, работает с MongoDB
  - ✅ `removePlayer` - async, работает с MongoDB
  - ✅ `useInventoryItem` - async, сохраняет в MongoDB
  - ✅ `applyUpgrade` - async, сохраняет в MongoDB
  - ✅ `getPlayers` - async, загружает из MongoDB
  - ✅ `getLeaderboard` - async, загружает из MongoDB
  - ✅ `getRecentMessages` - async, загружает из MongoDB
  - ✅ `getViewportColors` - async, работает с MongoDB
  - ✅ `getCellColor` - async, работает с MongoDB
  - ✅ `getOrInitCellHealth` - async, работает с MongoDB
- ✅ Обновлен GameGateway для async методов

## Что еще нужно сделать

### 1. Установить зависимости

```bash
cd backend/backend-app
npm install @nestjs/mongoose mongoose
```

### 2. Переписать оставшиеся методы GameService

Следующие методы все еще используют старые Map и должны быть переписаны:

- `movePlayer` - должен работать с MongoDB для сохранения позиции и обновления локальных чатов
- `tapColorCell` - должен работать с MongoDB для обновления здоровья клеток и прогресса игроков
- `tapWhiteCell` - должен работать с MongoDB
- `attackPlayer` - должен работать с MongoDB
- `addChatMessage` - должен работать с MongoDB
- `getLocalChat` - должен работать с MongoDB
- `getLocalChatParticipants` - должен работать с MongoDB
- `addLocalChatMessage` - должен работать с MongoDB
- `removePlayerFromLocalChat` - должен работать с MongoDB
- `joinLocalChat` / `leaveLocalChat` - должны работать с MongoDB

### 3. Обновить все вызовы в GameGateway

Все вызовы методов GameService должны использовать `await`, так как теперь они async.

### 4. Исправить синхронные вызовы

Методы, которые вызывают `getCellColorInternal`, должны быть async, так как он теперь async.

### 5. Тестирование

После завершения миграции необходимо протестировать:
- Создание игроков
- Движение игроков
- Сбор клеток
- Чат (глобальный и локальный)
- Лидерборд
- Инвентарь
- Бой между игроками

## Примеры переписывания

### movePlayer

```typescript
async movePlayer(clientId: string, position: CellPosition): Promise<PlayerState | undefined> {
  const player = await this.getOrCreatePlayer(clientId);
  if (!player) return undefined;
  
  // ... логика движения ...
  
  // Сохраняем изменения
  await this.savePlayer(player);
  
  // Обновляем локальные чаты в MongoDB
  const oldKey = `${oldPosition.x}:${oldPosition.y}`;
  const newKey = `${position.x}:${position.y}`;
  
  await this.localChatModel.updateOne(
    { key: oldKey },
    { $pull: { participants: clientId } }
  );
  
  await this.localChatModel.findOneAndUpdate(
    { key: newKey },
    {
      $setOnInsert: {
        key: newKey,
        cellPosition: position,
        participants: [],
        messages: [],
      },
    },
    { upsert: true }
  );
  
  await this.localChatModel.updateOne(
    { key: newKey },
    { $addToSet: { participants: clientId } }
  );
  
  return player;
}
```

### tapColorCell

```typescript
async tapColorCell(clientId: string, pos: CellPosition): Promise<{...}> {
  const player = await this.getOrCreatePlayer(clientId);
  const key = `${pos.x}:${pos.y}`;
  
  // Получаем или создаем клетку
  let cell = await this.cellModel.findOne({ key }).exec();
  if (!cell) {
    const color = await this.getCellColorInternal(pos);
    const health = this.getCellPower(color);
    cell = new this.cellModel({
      key,
      position: pos,
      color,
      health,
      playerProgress: {},
    });
    await cell.save();
  }
  
  // Обновляем прогресс игрока
  const currentProgress = cell.playerProgress[clientId] || 0;
  cell.playerProgress[clientId] = currentProgress + player.collectionPower;
  
  // Уменьшаем здоровье клетки
  if (cell.health !== null) {
    cell.health -= player.collectionPower;
  }
  
  // Если клетка собрана
  if (cell.health !== null && cell.health <= 0) {
    // Определяем победителя
    // Обновляем инвентарь игрока
    // Сохраняем изменения
  }
  
  await cell.save();
  await this.savePlayer(player);
  
  return { ... };
}
```
