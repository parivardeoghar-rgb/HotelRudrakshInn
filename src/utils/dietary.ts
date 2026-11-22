import type { MenuItem } from '../types';

export type MenuDietaryPreference = 'Jain' | 'Gluten-Free' | 'Nut-Free';

export const MENU_DIETARY_OPTIONS: {
  id: MenuDietaryPreference;
  label: string;
  description: string;
}[] = [
  {
    id: 'Jain',
    label: 'Jain',
    description: 'Prepared without onion, garlic, or root vegetables',
  },
  {
    id: 'Gluten-Free',
    label: 'Gluten-Free',
    description: 'Prepared without wheat, maida, or gluten grains',
  },
  {
    id: 'Nut-Free',
    label: 'Nut-Free',
    description: 'Prepared without cashews, almonds, pistachios, or peanuts',
  },
];

const NUT_REGEX =
  /\b(nut|nuts|cashew|cashews|kaju|almond|almonds|badam|pistachio|pistachios|pista|walnut|walnuts|peanut|peanuts|hazelnut|pecan)\b/i;

const GLUTEN_REGEX =
  /\b(wheat|whole-wheat|maida|atta|flour|naan|roti|paratha|kulcha|bhatura|poori|puri|chapati|phulka|noodle|noodles|pasta|macaroni|bread|bun|sandwich|samosa|kachori|gulab jamun|soy|soya)\b/i;

const ROOT_AND_ALLIUM_REGEX =
  /\b(onion|onions|pyaz|kanda|shallot|shallots|garlic|lehsun|potato|potatoes|aloo|alu|ginger|adrak|carrot|carrots|gajar|beetroot|radish|mooli|turnip|yam|sweet potato)\b/i;

export function matchesDietaryPreference(
  item: MenuItem,
  preference: MenuDietaryPreference
): boolean {
  const combinedText = `${item.name} ${item.description} ${item.categoryName}`.toLowerCase();

  if (preference === 'Nut-Free') {
    if (/\bnut[-\s]?free\b/i.test(combinedText)) return true;
    return !NUT_REGEX.test(combinedText);
  }

  if (preference === 'Gluten-Free') {
    if (/\bgluten[-\s]?free\b/i.test(combinedText)) return true;
    if (item.categoryId === 'cat_breads') return false;
    if (item.recipe?.some((ing) => ing.inventoryItemId === 'inv_flour')) return false;
    const normalizedForGluten = combinedText.replace(
      /\b(gram|besan|rice|corn|millet|ragi|buckwheat)[-\s]+flour\b/gi,
      ''
    );
    return !GLUTEN_REGEX.test(normalizedForGluten);
  }

  if (/\bjain\b/i.test(combinedText)) return true;
  return !ROOT_AND_ALLIUM_REGEX.test(combinedText);
}
