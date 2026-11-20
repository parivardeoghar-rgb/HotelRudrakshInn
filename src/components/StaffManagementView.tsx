import React, { useState } from 'react';
import {
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {
  deleteStaffInvite,
  provisionStaffAuthCredentials,
  sendAccountPasswordReset,
  updateStaffMemberRoleStatus,
  upsertStaffInvite,
} from '../services/firestoreService';
import {
  ROLE_ALLOWED_MODULES,
  ROLE_LABELS,
  ROLE_TO_PORTAL,
  type StaffInvite,
  type StaffProfile,
  type StaffRole,
  type WorkspaceModule,
} from '../types';
import { formatDateTime } from '../utils/format';
import { ConfirmDialog } from './ConfirmDialog';

interface StaffManagementViewProps {
  currentUser: StaffProfile;
  staffProfiles: StaffProfile[];
  staffInvites: StaffInvite[];
}

const ALL_ROLES: StaffRole[] = [
  'super_admin',
  'manager',
  'cashier',
  'waiter',
  'kitchen',
];

const MODULE_OPTIONS: { id: WorkspaceModule; label: string; adminOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Analytics Dashboard' },
  { id: 'tables', label: 'Tables & QR Codes' },
  { id: 'waiter', label: 'Waiter Service Panel' },
  { id: 'kds', label: 'Kitchen Display (KDS)' },
  { id: 'pos', label: 'POS & Billing' },
  { id: 'room_service', label: 'Room Service Folios' },
  { id: 'menu', label: 'Menu & Categories' },
  { id: 'inventory', label: 'Inventory & Stock' },
  { id: 'reports', label: 'Financial Reports' },
  { id: 'feedback', label: 'Guest Feedback' },
  { id: 'customers', label: 'Customers Directory', adminOnly: true },
  { id: 'staff', label: 'Staff Directory' },
  { id: 'audit', label: 'Audit Logs', adminOnly: true },
  { id: 'settings', label: 'System Settings', adminOnly: true },
];

export const StaffManagementView: React.FC<StaffManagementViewProps> = ({
  currentUser,
  staffProfiles,
  staffInvites,
}) => {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<StaffRole>('waiter');
  const [phone, setPhone] = useState('');
  const [shift, setShift] = useState('Morning (07:00 – 15:00)');
  const [tempPassword, setTempPassword] = useState('');
  const [permissions, setPermissions] = useState<WorkspaceModule[]>(
    ROLE_ALLOWED_MODULES.waiter
  );
  const [saving, setSaving] = useState(false);
  const [deleteInviteTarget, setDeleteInviteTarget] = useState<StaffInvite | null>(null);
  const [editingPermsTarget, setEditingPermsTarget] = useState<StaffProfile | null>(null);
  const [editingPermsList, setEditingPermsList] = useState<WorkspaceModule[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const isSuperAdmin = currentUser.role === 'super_admin';

  const handleRoleChange = (nextRole: StaffRole) => {
    setRole(nextRole);
    setPermissions(ROLE_ALLOWED_MODULES[nextRole]);
  };

  const toggleCreatePermission = (mod: WorkspaceModule) => {
    setPermissions((prev) =>
      prev.includes(mod) ? prev.filter((m) => m !== mod) : [...prev, mod]
    );
  };

  const handleAddInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !displayName.trim() || !isSuperAdmin) return;
    setSaving(true);
    try {
      const effectivePerms =
        permissions.length > 0 ? permissions : ROLE_ALLOWED_MODULES[role];

      await upsertStaffInvite({
        email,
        displayName,
        role,
        active: true,
        phone,
        shift,
        permissions: effectivePerms,
        createdBy: currentUser.uid,
        actor: currentUser,
      });

      let authNote = '';
      if (tempPassword.trim().length >= 6) {
        const res = await provisionStaffAuthCredentials({
          email,
          password: tempPassword.trim(),
          displayName,
        });
        authNote = ` ${res.message}`;
      }

      setStatusMsg(
        `Authorized ${displayName} (${email}) for /${ROLE_TO_PORTAL[role]}/login as ${ROLE_LABELS[role]}.${authNote}`
      );
      setEmail('');
      setDisplayName('');
      setPhone('');
      setTempPassword('');
      setTimeout(() => setStatusMsg(null), 6500);
    } finally {
      setSaving(false);
    }
  };

  const handleSendPasswordReset = async (targetEmail: string) => {
    try {
      await sendAccountPasswordReset(targetEmail, currentUser);
      setStatusMsg(`Password reset email sent to ${targetEmail}.`);
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (err) {
      setStatusMsg(
        err instanceof Error ? err.message : 'Unable to send password reset email.'
      );
    }
  };

  const openPermissionsModal = (sp: StaffProfile) => {
    setEditingPermsTarget(sp);
    setEditingPermsList(
      sp.permissions && sp.permissions.length > 0
        ? sp.permissions
        : ROLE_ALLOWED_MODULES[sp.role]
    );
  };

  const savePermissionsModal = async () => {
    if (!editingPermsTarget) return;
    const finalPerms =
      editingPermsList.length > 0
        ? editingPermsList
        : ROLE_ALLOWED_MODULES[editingPermsTarget.role];
    await updateStaffMemberRoleStatus(
      editingPermsTarget.uid,
      editingPermsTarget.email,
      { permissions: finalPerms },
      currentUser
    );
    setStatusMsg(`Updated module permissions for ${editingPermsTarget.displayName}.`);
    setEditingPermsTarget(null);
    setTimeout(() => setStatusMsg(null), 4000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-zinc-900">
          Staff Accounts & Role Access Control
        </h2>
        <p className="text-xs text-zinc-500 mt-0.5">
          Provision staff portal logins, assign roles & granular module permissions, send password resets, and monitor activity
        </p>
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-900">
          {statusMsg}
        </div>
      )}

      {/* Create Staff Authorization Form (Super Admin Only) */}
      {isSuperAdmin && (
        <form
          onSubmit={(e) => void handleAddInvite(e)}
          className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
              <UserPlus className="w-4 h-4 text-[#9A7415]" />
              Create / Authorize Staff Account
            </div>
            <span className="font-mono-tabular text-[11px] text-zinc-500">
              Dedicated Portal: /{ROLE_TO_PORTAL[role]}/login
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                maxLength={80}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Staff Full Name"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Staff Email</label>
              <input
                type="email"
                required
                maxLength={120}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="staff@hotelrudrakshinn.com"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Assigned Role</label>
              <select
                value={role}
                onChange={(e) => handleRoleChange(e.target.value as StaffRole)}
                className="w-full px-3 py-2 rounded-lg border border-zinc-300 font-semibold"
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Phone Number</label>
              <input
                type="text"
                maxLength={20}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765..."
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">Assigned Shift</label>
              <input
                type="text"
                maxLength={40}
                value={shift}
                onChange={(e) => setShift(e.target.value)}
                placeholder="Shift"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
            <div>
              <label className="block font-semibold text-zinc-700 mb-1">
                Initial Password (Optional · Email/Pass Login)
              </label>
              <input
                type="password"
                minLength={6}
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                placeholder="Min 6 chars (leave blank for Google)"
                className="w-full px-3 py-2 rounded-lg border border-zinc-300"
              />
            </div>
          </div>

          {/* Granular Module Permissions */}
          <div className="pt-2 border-t border-zinc-100 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-800">
                Granular Module Permissions ({permissions.length} selected)
              </span>
              <button
                type="button"
                onClick={() => setPermissions(ROLE_ALLOWED_MODULES[role])}
                className="text-[11px] font-semibold text-[#9A7415] hover:underline cursor-pointer"
              >
                Reset to {ROLE_LABELS[role]} Default
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {MODULE_OPTIONS.filter((m) => !m.adminOnly || role === 'super_admin').map((mod) => (
                <label
                  key={mod.id}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium cursor-pointer ${
                    permissions.includes(mod.id)
                      ? 'bg-amber-50 border-amber-200 text-zinc-900'
                      : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={permissions.includes(mod.id)}
                    onChange={() => toggleCreatePermission(mod.id)}
                    className="accent-[#141518]"
                  />
                  <span className="truncate">{mod.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <span className="text-[11px] text-zinc-500">
              Passwords are created directly via Firebase Auth (never stored in Firestore). Staff can sign in via Google or verified Email/Password at their assigned portal.
            </span>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              {saving ? 'Provisioning...' : 'Provision & Authorize Staff'}
            </button>
          </div>
        </form>
      )}

      {/* Active Signed-In Staff Profiles */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#9A7415]" />
            Active Staff Profiles ({staffProfiles.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email & Portal</th>
                <th className="px-4 py-3 font-semibold">Shift & Last Active</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Permissions</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                {isSuperAdmin && (
                  <th className="px-4 py-3 font-semibold text-right">Credentials</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {staffProfiles.map((sp) => {
                const effPerms =
                  sp.permissions && sp.permissions.length > 0
                    ? sp.permissions
                    : ROLE_ALLOWED_MODULES[sp.role];
                return (
                  <tr key={sp.uid}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-900">{sp.displayName}</div>
                      {sp.phone && (
                        <div className="font-mono-tabular text-[11px] text-zinc-500">{sp.phone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      <div>{sp.email}</div>
                      <div className="font-mono-tabular text-[11px] text-zinc-400">
                        /{ROLE_TO_PORTAL[sp.role]}/login
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">
                      <div>{sp.shift || '—'}</div>
                      <div className="font-mono-tabular text-[11px] text-zinc-400">
                        {sp.lastLoginAt ? formatDateTime(sp.lastLoginAt) : 'First login pending'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isSuperAdmin && sp.uid !== currentUser.uid ? (
                        <select
                          value={sp.role}
                          onChange={(e) =>
                            void updateStaffMemberRoleStatus(
                              sp.uid,
                              sp.email,
                              { role: e.target.value as StaffRole },
                              currentUser
                            )
                          }
                          className="px-2.5 py-1 rounded border border-zinc-300 bg-zinc-50 font-semibold"
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-semibold text-[#9A7415]">
                          {ROLE_LABELS[sp.role]}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isSuperAdmin && sp.uid !== currentUser.uid ? (
                        <button
                          type="button"
                          onClick={() => openPermissionsModal(sp)}
                          className="px-2.5 py-1 rounded border border-zinc-300 bg-white hover:bg-zinc-50 text-zinc-800 font-medium inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                        >
                          <SlidersHorizontal className="w-3 h-3 text-[#9A7415]" />
                          <span className="font-mono-tabular">{effPerms.length} modules</span>
                        </button>
                      ) : (
                        <span className="font-mono-tabular text-zinc-600">
                          {effPerms.length} modules
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isSuperAdmin && sp.uid !== currentUser.uid ? (
                        <button
                          type="button"
                          onClick={() =>
                            void updateStaffMemberRoleStatus(
                              sp.uid,
                              sp.email,
                              { active: !sp.active },
                              currentUser
                            )
                          }
                          className={`px-2.5 py-1 rounded font-semibold cursor-pointer ${
                            sp.active
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          {sp.active ? 'Active' : 'Deactivated'}
                        </button>
                      ) : (
                        <span className="text-emerald-700 font-semibold">
                          {sp.active ? 'Active' : 'Deactivated'}
                        </span>
                      )}
                    </td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleSendPasswordReset(sp.email)}
                          className="px-2.5 py-1 rounded border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-medium inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                          title="Send password reset email"
                        >
                          <KeyRound className="w-3 h-3 text-[#9A7415]" />
                          Reset Password
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pre-Authorized Email Directory / Invites */}
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-200">
          <h3 className="text-sm font-bold text-zinc-900">
            Staff Email Authorizations ({staffInvites.length})
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Authorized Email</th>
                <th className="px-4 py-3 font-semibold">Assigned Role</th>
                <th className="px-4 py-3 font-semibold">Modules</th>
                <th className="px-4 py-3 font-semibold">Access</th>
                <th className="px-4 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {staffInvites.map((inv) => {
                const modCount =
                  inv.permissions && inv.permissions.length > 0
                    ? inv.permissions.length
                    : ROLE_ALLOWED_MODULES[inv.role].length;
                return (
                  <tr key={inv.inviteId}>
                    <td className="px-4 py-3 font-semibold">{inv.displayName}</td>
                    <td className="px-4 py-3 text-zinc-600">{inv.email}</td>
                    <td className="px-4 py-3 font-semibold text-[#9A7415]">
                      {ROLE_LABELS[inv.role]}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-zinc-600">
                      {modCount} modules
                    </td>
                    <td className="px-4 py-3">
                      {inv.active ? (
                        <span className="text-emerald-700 font-semibold">Enabled</span>
                      ) : (
                        <span className="text-red-600 font-semibold">Revoked</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => setDeleteInviteTarget(inv)}
                          className="p-1.5 rounded border border-zinc-200 text-red-600 hover:bg-red-50 cursor-pointer"
                          title="Revoke authorization"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Staff Module Permissions Modal */}
      {editingPermsTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[#141518] text-white flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">
                  Manage Module Permissions
                </h3>
                <p className="text-xs text-zinc-400">
                  {editingPermsTarget.displayName} · {ROLE_LABELS[editingPermsTarget.role]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingPermsTarget(null)}
                className="text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-700">
                  Select authorized workspace modules
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditingPermsList(ROLE_ALLOWED_MODULES[editingPermsTarget.role])
                  }
                  className="font-semibold text-[#9A7415] hover:underline cursor-pointer"
                >
                  Reset to Role Default
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {MODULE_OPTIONS.filter(
                  (m) => !m.adminOnly || editingPermsTarget.role === 'super_admin'
                ).map((mod) => (
                  <label
                    key={mod.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium cursor-pointer ${
                      editingPermsList.includes(mod.id)
                        ? 'bg-amber-50 border-amber-200 text-zinc-900'
                        : 'bg-zinc-50 border-zinc-200 text-zinc-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={editingPermsList.includes(mod.id)}
                      onChange={() =>
                        setEditingPermsList((prev) =>
                          prev.includes(mod.id)
                            ? prev.filter((p) => p !== mod.id)
                            : [...prev, mod.id]
                        )
                      }
                      className="accent-[#141518]"
                    />
                    <span>{mod.label}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-100">
                <button
                  type="button"
                  onClick={() => setEditingPermsTarget(null)}
                  className="px-4 py-2 rounded-lg border border-zinc-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void savePermissionsModal()}
                  className="px-4 py-2 rounded-lg bg-[#141518] text-[#D4AF37] text-xs font-semibold cursor-pointer"
                >
                  Save Permissions
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteInviteTarget)}
        title={`Remove Authorization for ${deleteInviteTarget?.displayName}?`}
        description="Deletes this pre-authorized staff email entry. Existing signed-in accounts can also be deactivated above."
        confirmLabel="Remove"
        onConfirm={() => {
          if (deleteInviteTarget) {
            void deleteStaffInvite(deleteInviteTarget.inviteId, currentUser);
          }
          setDeleteInviteTarget(null);
        }}
        onCancel={() => setDeleteInviteTarget(null)}
      />
    </div>
  );
};
