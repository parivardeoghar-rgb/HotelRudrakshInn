import type { MealSession, MenuItem } from '../types';

export interface MealSessionOption {
  id: MealSession;
  label: string;
  shortLabel: string;
  windowLabel: string;
  deliverySlots: string[];
}

export const MEAL_SESSION_OPTIONS: MealSessionOption[] = [
  {
    id: 'Morning Breakfast',
    label: 'Morning · Breakfast',
    shortLabel: 'Breakfast',
    windowLabel: '07:00 AM – 11:00 AM',
    deliverySlots: ['ASAP (Now)', '07:30 AM', '08:30 AM', '09:30 AM', '10:30 AM'],
  },
  {
    id: 'Afternoon Lunch',
    label: 'Afternoon · Lunch',
    shortLabel: 'Lunch',
    windowLabel: '12:00 PM – 03:30 PM',
    deliverySlots: ['ASAP (Now)', '12:30 PM', '01:30 PM', '02:30 PM', '03:15 PM'],
  },
  {
    id: 'Evening',
    label: 'Evening · Snacks & Tea',
    shortLabel: 'Evening',
    windowLabel: '04:00 PM – 07:00 PM',
    deliverySlots: ['ASAP (Now)', '04:30 PM', '05:30 PM', '06:30 PM'],
  },
  {
    id: 'Dinner',
    label: 'Night · Dinner',
    shortLabel: 'Dinner',
    windowLabel: '07:30 PM – 11:00 PM',
    deliverySlots: ['ASAP (Now)', '08:00 PM', '09:00 PM', '10:00 PM'],
  },
];

export function getDefaultMealSessionForHour(now: Date = new Date()): MealSession {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < 11 * 60 + 30) return 'Morning Breakfast';
  if (mins < 15 * 60 + 45) return 'Afternoon Lunch';
  if (mins < 19 * 60 + 15) return 'Evening';
  return 'Dinner';
}

export function getMealSessionMeta(session?: MealSession | null): MealSessionOption {
  return (
    MEAL_SESSION_OPTIONS.find((opt) => opt.id === session) ||
    MEAL_SESSION_OPTIONS[0]
  );
}

export function matchesMealSession(
  item: MenuItem,
  session: MealSession | null
): boolean {
  if (!session) return true;

  const cat = (item.categoryName || '').toLowerCase();
  const catId = (item.categoryId || '').toLowerCase();
  const text = `${item.name} ${item.description}`.toLowerCase();

  switch (session) {
    case 'Morning Breakfast':
      return (
        catId === 'cat_breakfast' ||
        catId === 'cat_beverages' ||
        cat.includes('breakfast') ||
        cat.includes('beverage') ||
        cat.includes('tea') ||
        cat.includes('coffee') ||
        text.includes('dosa') ||
        text.includes('paratha') ||
        text.includes('idli') ||
        text.includes('poha') ||
        text.includes('lassi') ||
        text.includes('shikanji')
      );

    case 'Afternoon Lunch':
      return (
        catId === 'cat_starters' ||
        catId === 'cat_mains' ||
        catId === 'cat_breads' ||
        catId === 'cat_rice' ||
        catId === 'cat_beverages' ||
        catId === 'cat_desserts' ||
        cat.includes('main') ||
        cat.includes('lunch') ||
        cat.includes('thali') ||
        cat.includes('starter') ||
        cat.includes('bread') ||
        cat.includes('rice') ||
        cat.includes('biryani') ||
        cat.includes('beverage') ||
        cat.includes('dessert')
      );

    case 'Evening':
      return (
        catId === 'cat_snacks' ||
        catId === 'cat_starters' ||
        catId === 'cat_chinese' ||
        catId === 'cat_beverages' ||
        catId === 'cat_desserts' ||
        cat.includes('snack') ||
        cat.includes('starter') ||
        cat.includes('chinese') ||
        cat.includes('beverage') ||
        cat.includes('chaat') ||
        cat.includes('dessert') ||
        text.includes('dosa') ||
        text.includes('pakora')
      );

    case 'Dinner':
      return (
        catId === 'cat_starters' ||
        catId === 'cat_mains' ||
        catId === 'cat_chinese' ||
        catId === 'cat_breads' ||
        catId === 'cat_rice' ||
        catId === 'cat_desserts' ||
        cat.includes('starter') ||
        cat.includes('main') ||
        cat.includes('chinese') ||
        cat.includes('bread') ||
        cat.includes('rice') ||
        cat.includes('biryani') ||
        cat.includes('dessert') ||
        cat.includes('dinner')
      );

    default:
      return true;
  }
}
