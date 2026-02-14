export type CellColor = string;

export interface CellPosition {
  x: number;
  y: number;
}

export interface PlayerInventory {
  // color -> count
  [color: CellColor]: number;
}

export interface PlayerState {
  id: string;
  name: string;
  position: CellPosition;
  unlockedColors: CellColor[];
  inventory: PlayerInventory;
  totalCollected: number;
  // Уровни опыта для каждого цвета (color -> level)
  colorLevels: { [color: CellColor]: number };
  // Параметры игрока
  satiety: number; // Сытость от 0 до weight (тратится при движении, восстанавливается ресурсами)
  weight: number; // Максимальная сытость (изначально 255, улучшается на 10%)
  stamina: number; // Выносливость - используется в формуле траты сытости: weight * 0.01 * (collectionPower - stamina) (изначально 1, улучшается +1)
  collectionPower: number; // Сила сбора - проверка возможности сбора: cellPower < collectionPower * (power/2 + stamina/2 - defense) (изначально 10, улучшается +1)
  experience: number; // Очки опыта (получается из синего компонента ресурсов)
  power: number; // Сила атаки - урон при атаке другого игрока (изначально 1, улучшается +1)
  level: number; // Уровень игрока (изначально 1, повышается при накоплении опыта: level * 255)
  availableUpgrades: number; // Количество доступных улучшений (получается при повышении уровня)
  // Дополнительные параметры
  health: number; // Здоровье от 0 до maxHealth (отдельно от сытости, для PvP)
  maxHealth: number; // Максимальное здоровье (изначально 100, улучшается на 20%)
  defense: number; // Защита - снижает получаемый урон: damage = max(1, damage - defense) (изначально 0, улучшается +1)
  luck: number; // Удача - влияет на количество собираемых ресурсов: bonus = floor(luck / 5) (изначально 0, улучшается +1)
  regeneration: number; // Регенерация - восстанавливает сытость каждые 10 секунд (изначально 0, улучшается +0.5)
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  totalCollected: number;
  level: number;
  playTime: number; // Время игры в секундах
  isOnline: boolean;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  createdAt: number;
}

export interface LocalChatMessage {
  id: string;
  playerId: string;
  name: string;
  text: string;
  createdAt: number;
  cellPosition: CellPosition;
}

export interface LocalChat {
  cellPosition: CellPosition;
  participants: string[]; // player IDs
  messages: LocalChatMessage[];
}
