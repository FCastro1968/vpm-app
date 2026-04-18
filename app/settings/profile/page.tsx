'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

function initials(name: string | null, email: string) {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/)
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

export default function ProfilePage() {
  const supabase = createClient()

  const [email,        setEmail]        = useState('')
  const [displayName,  setDisplayName]  = useState('')
  const [savedName,    setSavedName]    = useState('')
  const [nameStatus,   setNameStatus]   = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const [currentPw,    setCurrentPw]    = useState('')
  const [newPw,        setNewPw]        = useState('')
  const [confirmPw,    setConfirmPw]    = useState('')
  const [pwStatus,     setPwStatus]     = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [pwError,      setPwError]      = useState('')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setEmail(user.email ?? '')
      const name = user.user_metadata?.full_name ?? ''
      setDisplayName(name)
      setSavedName(name)
    })
  }, [])

  async function saveName() {
    setNameStatus('saving')
    const { error } = await supabase.auth.updateUser({ data: { full_name: displayName.trim() } })
    if (error) { setNameStatus('error'); return }
    setSavedName(displayName.trim())
    setNameStatus('saved')
    setTimeout(() => setNameStatus('idle'), 2500)
  }

  async function changePassword() {
    setPwError('')
    if (newPw.length < 8) { setPwError('Password must be at least 8 characters.'); return }
    if (newPw !== confirmPw) { setPwError('Passwords do not match.'); return }
    setPwStatus('saving')
    const { error } = await supabase.auth.updateUser({ password: newPw })
    if (error) { setPwError(error.message); setPwStatus('error'); return }
    setCurrentPw(''); setNewPw(''); setConfirmPw('')
    setPwStatus('saved')
    setTimeout(() => setPwStatus('idle'), 2500)
  }

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Profile</h1>

      {/* Avatar */}
      <div className="flex items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-blue-600 text-white text-xl font-bold flex items-center justify-center select-none">
          {initials(savedName || null, email)}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">{savedName || email}</p>
          <p className="text-xs text-gray-500">{email}</p>
        </div>
      </div>

      {/* Display name */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Display Name</h2>
        <div className="flex items-center gap-3 max-w-md">
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveName()}
            placeholder="Your name"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
          <button
            onClick={saveName}
            disabled={nameStatus === 'saving' || displayName.trim() === savedName}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {nameStatus === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
        {nameStatus === 'saved' && <p className="mt-2 text-xs text-green-600">Saved.</p>}
        {nameStatus === 'error'  && <p className="mt-2 text-xs text-red-600">Failed to save.</p>}
      </section>

      {/* Email — read-only */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Email</h2>
        <p className="text-xs text-gray-500 mb-3">Managed by your sign-in provider. Contact support to change.</p>
        <input
          type="email"
          value={email}
          readOnly
          className="px-3 py-2 border border-gray-200 rounded-md text-sm text-gray-500 bg-gray-50 max-w-md w-full cursor-not-allowed"
        />
      </section>

      {/* Password */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Change Password</h2>
        <div className="space-y-3 max-w-md">
          <input
            type="password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            placeholder="New password"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
          <input
            type="password"
            value={confirmPw}
            onChange={e => setConfirmPw(e.target.value)}
            placeholder="Confirm new password"
            onKeyDown={e => e.key === 'Enter' && changePassword()}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          />
          {pwError && <p className="text-xs text-red-600">{pwError}</p>}
          <button
            onClick={changePassword}
            disabled={pwStatus === 'saving' || !newPw || !confirmPw}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {pwStatus === 'saving' ? 'Updating…' : 'Update Password'}
          </button>
          {pwStatus === 'saved' && <p className="text-xs text-green-600">Password updated.</p>}
        </div>
      </section>
    </div>
  )
}
