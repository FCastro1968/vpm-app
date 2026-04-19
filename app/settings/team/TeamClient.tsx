'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Member {
  id: string
  user_id: string | null
  role: string
  invited_email: string | null
  joined_at: string | null
  created_at: string
}

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' }

function roleBadge(role: string) {
  const colors: Record<string, string> = {
    owner:  'bg-purple-50 text-purple-700',
    admin:  'bg-blue-50 text-blue-700',
    member: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colors[role] ?? colors.member}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

export default function TeamClient({
  orgId,
  currentUserId,
  currentRole,
  members: initialMembers,
}: {
  orgId: string
  currentUserId: string
  currentRole: string
  members: Member[]
}) {
  const [members, setMembers]       = useState(initialMembers)
  const [inviteEmail, setInvite]    = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [sending, setSending]       = useState(false)
  const [inviteError, setInviteErr] = useState('')
  const [inviteSent, setInviteSent] = useState('')
  const supabase = createClient()

  const canManage = currentRole === 'owner' || currentRole === 'admin'

  const joined  = members.filter(m => m.joined_at)
  const pending = members.filter(m => !m.joined_at)

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setSending(true)
    setInviteErr('')
    setInviteSent('')

    // Check for duplicate
    const existing = members.find(m => m.invited_email?.toLowerCase() === inviteEmail.trim().toLowerCase())
    if (existing) {
      setInviteErr('This email is already a member or has a pending invite.')
      setSending(false)
      return
    }

    const { data, error } = await supabase
      .from('org_member')
      .insert({
        org_id: orgId,
        user_id: null,
        role: inviteRole,
        invited_email: inviteEmail.trim().toLowerCase(),
      })
      .select('id, user_id, role, invited_email, joined_at, created_at')
      .single()

    if (error) {
      setInviteErr(error.message)
      setSending(false)
      return
    }

    setMembers(prev => [...prev, data as Member])

    // Send invite email
    try {
      await fetch('/api/send-team-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      })
    } catch {
      // Non-fatal — invite row exists, email just didn't send
    }

    setInviteSent(inviteEmail.trim())
    setInvite('')
    setSending(false)
  }

  async function removeMember(member: Member) {
    if (member.user_id === currentUserId) return // can't remove yourself
    const { error } = await supabase.from('org_member').delete().eq('id', member.id)
    if (!error) setMembers(prev => prev.filter(m => m.id !== member.id))
  }

  async function changeRole(member: Member, role: string) {
    const { error } = await supabase.from('org_member').update({ role }).eq('id', member.id)
    if (!error) setMembers(prev => prev.map(m => m.id === member.id ? { ...m, role } : m))
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Team</h1>

      {/* Members */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">
          Members <span className="text-gray-400 font-normal">({joined.length})</span>
        </h2>
        <ul className="divide-y divide-gray-100">
          {joined.map(member => (
            <li key={member.id} className="flex items-center justify-between py-3 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="text-xs font-medium text-gray-500">
                    {(member.invited_email ?? '?')[0].toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-gray-900 truncate">{member.invited_email ?? '—'}</p>
                  <p className="text-xs text-gray-400">
                    {member.joined_at ? `Joined ${new Date(member.joined_at).toLocaleDateString()}` : ''}
                    {member.user_id === currentUserId ? ' · You' : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {canManage && member.user_id !== currentUserId && member.role !== 'owner' ? (
                  <select
                    value={member.role}
                    onChange={e => changeRole(member, e.target.value)}
                    className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:border-blue-400"
                  >
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  roleBadge(member.role)
                )}
                {canManage && member.user_id !== currentUserId && member.role !== 'owner' && (
                  <button
                    onClick={() => removeMember(member)}
                    className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Pending invites */}
      {pending.length > 0 && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">
            Pending Invites <span className="text-gray-400 font-normal">({pending.length})</span>
          </h2>
          <ul className="divide-y divide-gray-100">
            {pending.map(member => (
              <li key={member.id} className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-yellow-50 border border-dashed border-yellow-300 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm text-gray-700">{member.invited_email}</p>
                    <p className="text-xs text-gray-400">
                      Invited {new Date(member.created_at).toLocaleDateString()} · {roleBadge(member.role)}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <button
                    onClick={() => removeMember(member)}
                    className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50"
                  >
                    Cancel
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Invite form */}
      {canManage && (
        <section className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Invite a team member</h2>
          <p className="text-sm text-gray-500 mb-4">
            They'll receive an email with a link to join your workspace.
          </p>
          <form onSubmit={sendInvite} className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-52">
              <label className="block text-xs font-medium text-gray-700 mb-1">Email address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInvite(e.target.value)}
                placeholder="colleague@company.com"
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Role</label>
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as 'admin' | 'member')}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:border-blue-400"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={sending || !inviteEmail.trim()}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send Invite'}
            </button>
          </form>
          {inviteError && <p className="text-xs text-red-600 mt-2">{inviteError}</p>}
          {inviteSent && (
            <p className="text-xs text-green-600 mt-2">Invite sent to {inviteSent}.</p>
          )}
        </section>
      )}

      <section className="bg-gray-50 rounded-lg border border-gray-200 p-4">
        <p className="text-xs text-gray-500">
          <strong className="text-gray-700">Role permissions:</strong> Owners can manage billing and remove all members.
          Admins can invite and remove members. Members can view and edit shared projects.
        </p>
      </section>
    </div>
  )
}
