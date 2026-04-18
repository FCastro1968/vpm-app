'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function RequestAccessPage() {
  const [name,          setName]          = useState('')
  const [email,         setEmail]         = useState('')
  const [company,       setCompany]       = useState('')
  const [role,          setRole]          = useState('')
  const [projectVolume, setProjectVolume] = useState('')
  const [useCase,       setUseCase]       = useState('')
  const [status,        setStatus]        = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [errorMsg,      setErrorMsg]      = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('sending')
    setErrorMsg('')
    try {
      const res = await fetch('/api/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, company, role, projectVolume, useCase }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Something went wrong')
      }
      setStatus('sent')
    } catch (err: any) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Request received</h1>
          <p className="text-sm text-gray-500 mb-6">
            Thanks {name.split(' ')[0]}. We'll review your request and be in touch within one business day.
          </p>
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">← Back to home</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-sm font-semibold text-gray-900 hover:text-blue-600">
            ← Value Pricing Model™
          </Link>
          <Link href="/login" className="text-sm text-gray-500 hover:text-gray-900">Sign in</Link>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Request Access</h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            Access to Value Pricing Model™ is by invitation. Tell us about your use case
            and we'll be in touch within one business day.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Full name <span className="text-red-400">*</span></label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                placeholder="Jane Smith"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Work email <span className="text-red-400">*</span></label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="jane@company.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Company / Organization</label>
            <input
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="Acme Consulting"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Your role</label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Select…</option>
                <option>Independent Consultant</option>
                <option>Pricing Manager / Director</option>
                <option>Product Manager</option>
                <option>Strategy / Corporate Development</option>
                <option>Marketing</option>
                <option>Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Projects per month</label>
              <select
                value={projectVolume}
                onChange={e => setProjectVolume(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="">Select…</option>
                <option>1–2</option>
                <option>3–5</option>
                <option>6–10</option>
                <option>10+</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tell us about your use case</label>
            <textarea
              value={useCase}
              onChange={e => setUseCase(e.target.value)}
              rows={4}
              placeholder="What products are you pricing? What's your current process?"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
          </div>

          {status === 'error' && (
            <p className="text-xs text-red-600">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={status === 'sending' || !name || !email}
            className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {status === 'sending' ? 'Sending…' : 'Submit Request'}
          </button>

          <p className="text-xs text-gray-400 text-center">
            Already have an account? <Link href="/login" className="text-blue-600 hover:text-blue-700">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
