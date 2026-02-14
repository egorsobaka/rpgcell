# Правила расчетов параметров игрока

## Текущие параметры

### 1. **satiety** (Сытость)
- **Тип**: число от 0 до `weight`
- **Начальное значение**: 255
- **Правила**:
  - Тратится при движении: `moveCost = weight / (collectionPower - stamina)` (см. раздел "Движение" ниже)
  - Восстанавливается при использовании ресурсов: `satiety += greenComponent` (зеленый компонент HEX цвета)
  - Если `satiety < moveCost`, игрок не может двигаться
  - Не может превышать `weight`

### 2. **weight** (Вес / Максимальная сытость)
- **Тип**: число, минимум 255
- **Начальное значение**: 255
- **Правила**:
  - Определяет максимальное значение `satiety`
  - При улучшении: увеличивается на 10% (`weight = Math.round(weight * 1.1)`)
  - При улучшении `satiety` также увеличивается пропорционально
  - Влияет на максимальный вес инвентаря: `maxInventoryWeight = (weight / 2) + (weight / 2 * stamina / 10)`

### 3. **stamina** (Выносливость)
- **Тип**: целое число, минимум 1
- **Начальное значение**: 1
- **Правила**:
  - Используется в формуле траты сытости за один ход: `moveCost = weight * 0.01 * (collectionPower - stamina)`
  - При улучшении: увеличивается на 1 (`stamina += 1`)
  - Влияет на максимальный вес инвентаря (см. формулу выше)
  - Чем выше `stamina`, тем меньше тратится сытости при движении (при фиксированных `weight` и `collectionPower`)

### 4. **collectionPower** (Сила сбора)
- **Тип**: целое число, минимум 1
- **Начальное значение**: 10
- **Правила**:
  - Определяет, сколько единиц ресурса собирается за один тап: `collectedAmount = collectionPower`
  - При улучшении: увеличивается на 1 (`collectionPower += 1`)
  - Используется для проверки возможности сбора клетки: `cellPower < collectionPower * (power/2 + stamina/2 - defense)`
  - Влияет на скорость сбора ресурсов
  - Множитель рассчитывается как `(power/2 + stamina/2 - defense)`, минимум 0.1

### 5. **experience** (Опыт)
- **Тип**: число, минимум 0
- **Начальное значение**: 0
- **Правила**:
  - Получается при использовании ресурсов: `experience += blueComponent` (синий компонент HEX цвета)
  - Требуется для повышения уровня: `requiredExperience = level * 255`
  - При достижении уровня: `experience -= requiredExperience`, `level += 1`, `availableUpgrades += 1`

### 6. **power** (Сила атаки)
- **Тип**: целое число, минимум 1
- **Начальное значение**: 1
- **Правила**:
  - Определяет урон при атаке другого игрока: `damage = power`
  - При улучшении: увеличивается на 1 (`power += 1`)
  - Урон вычитается из `satiety` цели: `target.satiety = Math.max(0, target.satiety - power)`

### 7. **level** (Уровень)
- **Тип**: целое число, минимум 1
- **Начальное значение**: 1
- **Правила**:
  - Повышается при накоплении опыта: `requiredExperience = level * 255`
  - При повышении уровня: `level += 1`, `availableUpgrades += 1`
  - Влияет на требования к опыту для следующего уровня

### 8. **availableUpgrades** (Доступные улучшения)
- **Тип**: целое число, минимум 0
- **Начальное значение**: 0
- **Правила**:
  - Увеличивается при повышении уровня: `availableUpgrades += 1`
  - Уменьшается при использовании улучшения: `availableUpgrades -= 1`
  - Позволяет улучшить один из параметров: `weight`, `stamina`, `collectionPower`, `power`

## Недостающие параметры (предлагаемые)

### 9. **health** (Здоровье)
- **Тип**: число от 0 до `maxHealth`
- **Начальное значение**: 100
- **Правила**:
  - Отдельно от `satiety`, используется для PvP
  - Тратится при получении урона: `health = Math.max(0, health - damage)`
  - Восстанавливается со временем: `health += regeneration` (если `health < maxHealth`)
  - Если `health <= 0`, игрок не может атаковать (но может двигаться)

### 10. **maxHealth** (Максимальное здоровье)
- **Тип**: число, минимум 100
- **Начальное значение**: 100
- **Правила**:
  - Определяет максимальное значение `health`
  - При улучшении: увеличивается на 20% (`maxHealth = Math.round(maxHealth * 1.2)`)
  - При улучшении `health` также увеличивается пропорционально

### 11. **defense** (Защита)
- **Тип**: целое число, минимум 0
- **Начальное значение**: 0
- **Правила**:
  - Снижает получаемый урон: `actualDamage = Math.max(1, damage - defense)`
  - При улучшении: увеличивается на 1 (`defense += 1`)
  - Минимальный урон всегда 1, даже при высокой защите

### 12. **speed** (Скорость)
- **Тип**: целое число, минимум 1
- **Начальное значение**: 1
- **Правила**:
  - Определяет количество дополнительных ходов за один тап: `extraMoves = Math.floor(speed / 10)`
  - При улучшении: увеличивается на 1 (`speed += 1`)
  - Каждые 10 единиц скорости дают +1 дополнительный ход

### 13. **luck** (Удача)
- **Тип**: целое число, минимум 0
- **Начальное значение**: 0
- **Правила**:
  - Влияет на количество собираемых ресурсов: `bonusAmount = Math.floor(luck / 5)`
  - При улучшении: увеличивается на 1 (`luck += 1`)
  - Каждые 5 единиц удачи дают +1 к собираемому количеству ресурсов

### 14. **regeneration** (Регенерация)
- **Тип**: число, минимум 0
- **Начальное значение**: 0
- **Правила**:
  - Восстанавливает `satiety` каждые 10 секунд: `satiety = Math.min(weight, satiety + regeneration)`
  - При улучшении: увеличивается на 0.5 (`regeneration += 0.5`)
  - Не может превышать `weight`

### 15. **criticalChance** (Шанс критического удара)
- **Тип**: число от 0 до 100 (проценты)
- **Начальное значение**: 0
- **Правила**:
  - Определяет вероятность критического удара: `isCritical = Math.random() * 100 < criticalChance`
  - При улучшении: увеличивается на 2% (`criticalChance += 2`)
  - Максимальное значение: 50%

### 16. **criticalDamage** (Урон критического удара)
- **Тип**: число, минимум 1.5
- **Начальное значение**: 1.5
- **Правила**:
  - Множитель урона при критическом ударе: `damage = power * criticalDamage`
  - При улучшении: увеличивается на 0.1 (`criticalDamage += 0.1`)
  - Минимальное значение: 1.5x, максимальное: 3.0x

## Формулы расчетов

### Урон при атаке:
```
baseDamage = attacker.power
if (critical hit):
  damage = baseDamage * attacker.criticalDamage
else:
  damage = baseDamage

actualDamage = Math.max(1, damage - target.defense)
target.health = Math.max(0, target.health - actualDamage)
target.satiety = Math.max(0, target.satiety - actualDamage)
```

### Сбор ресурсов:
```
baseAmount = random(1, ceil(R / 32))
luckBonus = Math.floor(player.luck / 5)
collectedAmount = baseAmount + luckBonus
```

### Движение (расчет сытости на ход):
```
// Формула расчета стоимости одного хода:
difference = max(0, collectionPower - stamina)
moveCost = max(1, round(weight * 0.01 * difference))

// Примеры:
// Если weight = 255, collectionPower = 10, stamina = 1:
//   difference = max(0, 10 - 1) = 9
//   moveCost = max(1, round(255 * 0.01 * 9)) = max(1, round(22.95)) = 23

// Если weight = 255, collectionPower = 10, stamina = 5:
//   difference = max(0, 10 - 5) = 5
//   moveCost = max(1, round(255 * 0.01 * 5)) = max(1, round(12.75)) = 13

// Если weight = 255, collectionPower = 5, stamina = 10:
//   difference = max(0, 5 - 10) = 0
//   moveCost = max(1, round(255 * 0.01 * 0)) = 1

// Проверка возможности движения:
if (player.satiety >= moveCost):
  player.satiety -= moveCost
  // движение разрешено
else:
  // движение запрещено (недостаточно сытости)
```

**Важно:**
- Чем выше `stamina` (при фиксированных `weight` и `collectionPower`), тем меньше тратится сытости на ход
- Чем выше `collectionPower`, тем больше тратится сытости на ход (при фиксированных `weight` и `stamina`)
- Чем выше `weight`, тем больше тратится сытости на ход (но и максимальная сытость выше)
- Если `collectionPower <= stamina`, то `difference = 0` и `moveCost = 1` (минимальная стоимость)
- Минимальная стоимость хода всегда 1, даже если формула дает меньше

### Регенерация (каждые 10 секунд):
```
if (player.satiety < player.weight):
  player.satiety = Math.min(player.weight, player.satiety + player.regeneration)
```

### Вес инвентаря:
```
itemWeight = (count * G / 16) + (count * B / 32)
totalWeight = sum(itemWeight for all items)
maxWeight = (player.weight / 2) + (player.weight / 2 * player.stamina / 10)
```

### Опыт для уровня:
```
requiredExperience = level * 255
if (player.experience >= requiredExperience):
  player.experience -= requiredExperience
  player.level += 1
  player.availableUpgrades += 1
```

### Проверка возможности сбора клетки:
```
// Сила клетки рассчитывается из красного компонента цвета
cellPower = R + 1  // где R - красный компонент HEX (0-255), итого cellPower от 1 до 256

// Множитель для проверки возможности сбора
multiplier = (power / 2) + (stamina / 2) - defense
safeMultiplier = max(0.1, multiplier)  // минимум 0.1 для защиты

// Проверка возможности сбора
if (cellPower < collectionPower * safeMultiplier):
  // Клетку можно тапать
else:
  // Клетку нельзя тапать - недостаточно силы сбора
```

**Примеры:**
- Если `collectionPower = 10`, `power = 2`, `stamina = 1`, `defense = 0`:
  - `multiplier = (2/2) + (1/2) - 0 = 1 + 0.5 = 1.5`
  - Можно тапать клетки с `cellPower < 10 * 1.5 = 15` (R < 14)
  
- Если `collectionPower = 10`, `power = 4`, `stamina = 4`, `defense = 1`:
  - `multiplier = (4/2) + (4/2) - 1 = 2 + 2 - 1 = 3`
  - Можно тапать клетки с `cellPower < 10 * 3 = 30` (R < 29)
  
- Если `collectionPower = 10`, `power = 2`, `stamina = 1`, `defense = 3`:
  - `multiplier = (2/2) + (1/2) - 3 = 1 + 0.5 - 3 = -1.5`
  - `safeMultiplier = max(0.1, -1.5) = 0.1`
  - Можно тапать клетки с `cellPower < 10 * 0.1 = 1` (только клетки с R = 0)

**Важно:**
- Чем выше `power` и `stamina`, тем больше клеток доступно для сбора
- Чем выше `defense`, тем меньше клеток доступно для сбора
- Множитель не может быть меньше 0.1 (защита от слишком строгих ограничений)
