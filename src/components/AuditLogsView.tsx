import React, { useMemo, useState } from 'react';
import { History, Search } from 'lucide-react';
import type { AuditLog } from '../types';
import { formatDateTime } from '../utils/format';

interface AuditLogsViewProps {
  logs: AuditLog[];
}

export const AuditLogsView: React.FC<AuditLogsViewProps> = ({ logs }) => {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actorName.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q)
    );
  }, [logs, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-zinc-900">
            Security & Admin Audit Logs
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Immutable record of staff provisioning, role assignments, permissions, and account changes
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by action, admin, or detail..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-zinc-200 bg-white text-xs"
          />
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <History className="w-7 h-7 text-zinc-400 mx-auto" />
            <div className="text-sm font-semibold text-zinc-900">No audit entries recorded yet</div>
            <p className="text-xs text-zinc-500">
              Administrative changes to staff roles, permissions, password resets, and customer accounts appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Timestamp</th>
                  <th className="px-4 py-3 font-semibold">Action</th>
                  <th className="px-4 py-3 font-semibold">Performed By</th>
                  <th className="px-4 py-3 font-semibold">Target</th>
                  <th className="px-4 py-3 font-semibold">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtered.map((log) => (
                  <tr key={log.id} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono-tabular text-zinc-500 whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-[#9A7415] whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="px-4 py-3 font-semibold text-zinc-900">
                      {log.actorName}{' '}
                      <span className="text-zinc-500 font-normal">({log.actorRole})</span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{log.targetType}</td>
                    <td className="px-4 py-3 text-zinc-700">{log.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
