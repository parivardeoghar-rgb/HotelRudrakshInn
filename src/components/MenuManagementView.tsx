import React, { useState } from 'react';
import { Edit2, Plus, Trash2, Upload, X } from 'lucide-react';
import { DISH_IMAGES } from '../data/seedCatalog';
import {
  deleteMenuCategory,
  deleteMenuItem,
  saveMenuCategory,
  saveMenuItem,
} from '../services/firestoreService';
import type {
  InventoryItem,
  MenuCategory,
  MenuItem,
  RecipeIngredient,
} from '../types';
import { formatINR } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';
import { DishImage } from './DishImage';

interface MenuManagementViewProps {
  categories: MenuCategory[];
  menuItems: MenuItem[];
  inventory: InventoryItem[];
}

export const MenuManagementView: React.FC<MenuManagementViewProps> = ({
  categories,
  menuItems,
  inventory,
}) => {
  const [tab, setTab] = useState<'items' | 'categories'>('items');
  const [editingItem, setEditingItem] = useState<
    (Omit<MenuItem, 'createdAt' | 'updatedAt'> & { isNew?: boolean }) | null
  >(null);
  const [editingCat, setEditingCat] = useState<
    (Omit<MenuCategory, 'createdAt' | 'updatedAt'> & { isNew?: boolean }) | null
  >(null);
  const [deleteDishTarget, setDeleteDishTarget] = useState<MenuItem | null>(null);
  const [deleteCatTarget, setDeleteCatTarget] = useState<MenuCategory | null>(null);
  const [saving, setSaving] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingItem) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 480;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', 0.72);
        setEditingItem((prev) => (prev ? { ...prev, imageUrl: compressed } : prev));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setSaving(true);
    try {
      const cat = categories.find((c) => c.id === editingItem.categoryId);
      await saveMenuItem({
        ...editingItem,
        categoryName: cat?.name || editingItem.categoryName || 'General',
      });
      setEditingItem(null);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCat) return;
    setSaving(true);
    try {
      await saveMenuCategory(editingCat);
      setEditingCat(null);
    } finally {
      setSaving(false);
    }
  };

  const addRecipeIngredient = () => {
    if (!editingItem || inventory.length === 0) return;
    const first = inventory[0];
    const next: RecipeIngredient[] = [
      ...(editingItem.recipe || []),
      {
        inventoryItemId: first.id,
        inventoryItemName: first.name,
        quantityPerServing: 0.1,
        unit: first.unit,
      },
    ];
    setEditingItem({ ...editingItem, recipe: next });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Digital Menu & Recipe Catalog
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Manage dishes, INR pricing, availability, and kitchen stock recipe links
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-white border border-zinc-200 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('items')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'items' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
              }`}
            >
              Dishes ({menuItems.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('categories')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                tab === 'categories' ? 'bg-[#141518] text-[#D4AF37]' : 'text-zinc-600'
              }`}
            >
              Categories ({categories.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (tab === 'items') {
                const defaultCat = categories[0];
                setEditingItem({
                  id: '',
                  name: '',
                  description: '',
                  price: 250,
                  categoryId: defaultCat?.id || 'cat_mains',
                  categoryName: defaultCat?.name || 'Main Course',
                  isVeg: true,
                  isBestseller: false,
                  available: true,
                  imageUrl: DISH_IMAGES.paneerTikka,
                  sortOrder: menuItems.length + 1,
                  prepTimeMins: 15,
                  recipe: [],
                  isNew: true,
                });
              } else {
                setEditingCat({
                  id: '',
                  name: '',
                  sortOrder: categories.length + 1,
                  active: true,
                  isNew: true,
                });
              }
            }}
            className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {tab === 'items' ? 'Add Dish' : 'Add Category'}
          </button>
        </div>
      </div>

      {tab === 'items' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {menuItems.map((dish) => (
            <div
              key={dish.id}
              className="bg-white border border-zinc-200 rounded-xl overflow-hidden flex flex-col justify-between"
            >
              <div className="flex gap-3.5 p-4">
                <div className="w-24 h-24 rounded-lg overflow-hidden shrink-0 bg-zinc-900">
                  <DishImage src={dish.imageUrl} alt={dish.name} className="w-full h-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-zinc-500">
                    {dish.categoryName} · {dish.isVeg ? 'Veg' : 'Non-Veg'}
                    {dish.isBestseller ? ' · Bestseller' : ''}
                  </div>
                  <h3 className="text-sm font-bold text-zinc-900 mt-0.5 truncate">
                    {dish.name}
                  </h3>
                  <p className="text-xs text-zinc-500 line-clamp-2 mt-1">{dish.description}</p>
                  <div className="font-mono-tabular text-sm font-bold text-[#9A7415] mt-2">
                    {formatINR(dish.price)}
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    void saveMenuItem({ ...dish, available: !dish.available, isNew: false })
                  }
                  className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                    dish.available
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}
                >
                  {dish.available ? 'Available' : 'Unavailable'}
                </button>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingItem({ ...dish, isNew: false })}
                    className="p-1.5 rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                    title="Edit dish"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteDishTarget(dish)}
                    className="p-1.5 rounded-lg border border-zinc-300 bg-white text-red-600 hover:bg-red-50 cursor-pointer"
                    title="Delete dish"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Order</th>
                <th className="px-4 py-3 font-semibold">Category Name</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {categories.map((cat) => (
                <tr key={cat.id}>
                  <td className="px-4 py-3 font-mono-tabular">{cat.sortOrder}</td>
                  <td className="px-4 py-3 font-semibold text-zinc-900">{cat.name}</td>
                  <td className="px-4 py-3">
                    {cat.active ? (
                      <span className="text-emerald-700 font-semibold">Active</span>
                    ) : (
                      <span className="text-zinc-400">Hidden</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditingCat({ ...cat, isNew: false })}
                      className="text-zinc-700 hover:underline font-semibold cursor-pointer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteCatTarget(cat)}
                      className="text-red-600 hover:underline font-semibold cursor-pointer"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Dish Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSaveItem(e)}
            className="w-full max-w-lg bg-white rounded-xl shadow-2xl overflow-hidden my-auto"
          >
            <div className="px-5 py-4 bg-[#141518] text-white flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {editingItem.isNew ? 'Add Menu Dish' : `Edit ${editingItem.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3.5 max-h-[75vh] overflow-y-auto text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1">Dish Name</label>
                  <input
                    required
                    maxLength={100}
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1">Price (INR ₹)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={editingItem.price}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, price: Number(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1">Category</label>
                  <select
                    value={editingItem.categoryId}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, categoryId: e.target.value })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-zinc-700 mb-1">Sort Order</label>
                  <input
                    type="number"
                    min={1}
                    value={editingItem.sortOrder}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, sortOrder: Number(e.target.value) || 1 })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-mono-tabular"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-zinc-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  maxLength={400}
                  value={editingItem.description}
                  onChange={(e) =>
                    setEditingItem({ ...editingItem, description: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-zinc-300"
                />
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingItem.isVeg}
                    onChange={(e) => setEditingItem({ ...editingItem, isVeg: e.target.checked })}
                  />
                  Pure Veg
                </label>
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingItem.isBestseller}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, isBestseller: e.target.checked })
                    }
                  />
                  Bestseller Tag
                </label>
                <label className="inline-flex items-center gap-2 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingItem.available}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, available: e.target.checked })
                    }
                  />
                  Available on Menu
                </label>
              </div>

              {/* Dish Image Picker / Upload */}
              <div className="space-y-2 pt-2 border-t border-zinc-100">
                <label className="block font-semibold text-zinc-700">Dish Image</label>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(DISH_IMAGES).map(([key, url]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEditingItem({ ...editingItem, imageUrl: url })}
                      className={`w-12 h-12 rounded-lg overflow-hidden border-2 cursor-pointer ${
                        editingItem.imageUrl === url ? 'border-[#C59B27]' : 'border-zinc-200'
                      }`}
                    >
                      <img src={url} alt={key} className="w-full h-full object-cover" />
                    </button>
                  ))}
                  <label className="px-3 py-2 rounded-lg border border-dashed border-zinc-300 inline-flex items-center gap-1.5 cursor-pointer hover:bg-zinc-50">
                    <Upload className="w-3.5 h-3.5" />
                    Upload Photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Recipe Ingredient Mapping */}
              <div className="space-y-2 pt-2 border-t border-zinc-100">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-zinc-700">
                    Recipe Ingredient Stock Mapping
                  </span>
                  <button
                    type="button"
                    onClick={addRecipeIngredient}
                    className="text-[#9A7415] font-semibold hover:underline cursor-pointer"
                  >
                    + Link Ingredient
                  </button>
                </div>
                {(editingItem.recipe || []).map((ing, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={ing.inventoryItemId}
                      onChange={(e) => {
                        const inv = inventory.find((i) => i.id === e.target.value);
                        if (!inv) return;
                        const updated = [...(editingItem.recipe || [])];
                        updated[idx] = {
                          inventoryItemId: inv.id,
                          inventoryItemName: inv.name,
                          quantityPerServing: updated[idx].quantityPerServing,
                          unit: inv.unit,
                        };
                        setEditingItem({ ...editingItem, recipe: updated });
                      }}
                      className="flex-1 px-2 py-1.5 rounded border border-zinc-300"
                    >
                      {inventory.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name} ({i.unit})
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={ing.quantityPerServing}
                      onChange={(e) => {
                        const updated = [...(editingItem.recipe || [])];
                        updated[idx] = {
                          ...updated[idx],
                          quantityPerServing: Number(e.target.value) || 0,
                        };
                        setEditingItem({ ...editingItem, recipe: updated });
                      }}
                      className="w-20 px-2 py-1.5 rounded border border-zinc-300 font-mono-tabular"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const updated = (editingItem.recipe || []).filter((_, i) => i !== idx);
                        setEditingItem({ ...editingItem, recipe: updated });
                      }}
                      className="text-red-600 p-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-5 py-3.5 bg-zinc-50 border-t border-zinc-200 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 rounded-lg border border-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Dish'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Category Modal */}
      {editingCat && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleSaveCategory(e)}
            className="w-full max-w-sm bg-white rounded-xl p-5 space-y-4"
          >
            <h3 className="text-sm font-bold">
              {editingCat.isNew ? 'Add Menu Category' : 'Edit Category'}
            </h3>
            <input
              required
              maxLength={60}
              value={editingCat.name}
              onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
              placeholder="Category Name"
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-sm"
            />
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-2">
                Sort Order:
                <input
                  type="number"
                  min={1}
                  value={editingCat.sortOrder}
                  onChange={(e) =>
                    setEditingCat({ ...editingCat, sortOrder: Number(e.target.value) || 1 })
                  }
                  className="w-16 px-2 py-1 rounded border border-zinc-300 font-mono-tabular"
                />
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingCat.active}
                  onChange={(e) => setEditingCat({ ...editingCat, active: e.target.checked })}
                />
                Active
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingCat(null)}
                className="px-3 py-2 rounded-lg border border-zinc-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
              >
                Save Category
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteDishTarget)}
        title={`Delete ${deleteDishTarget?.name}?`}
        description="This dish will be permanently removed from the digital QR menu and POS picker."
        confirmLabel="Delete Dish"
        onConfirm={() => {
          if (deleteDishTarget) void deleteMenuItem(deleteDishTarget.id);
          setDeleteDishTarget(null);
        }}
        onCancel={() => setDeleteDishTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteCatTarget)}
        title={`Delete ${deleteCatTarget?.name}?`}
        description="Removes this menu category. Dishes under it should be reassigned to another category."
        confirmLabel="Delete Category"
        onConfirm={() => {
          if (deleteCatTarget) void deleteMenuCategory(deleteCatTarget.id);
          setDeleteCatTarget(null);
        }}
        onCancel={() => setDeleteCatTarget(null)}
      />
    </div>
  );
};
