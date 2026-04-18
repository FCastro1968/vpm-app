export default function TeamPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Team</h1>
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a4 4 0 00-5-4M9 20H4v-2a4 4 0 015-4m0 0a4 4 0 118 0m-8 0a4 4 0 108 0" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Team collaboration requires Professional plan</p>
            <p className="text-sm text-gray-500 mt-1">
              Invite team members, assign seats, and collaborate on projects together.
              Upgrade to Professional to unlock up to 5 seats.
            </p>
            <button
              disabled
              className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md opacity-50 cursor-not-allowed"
            >
              Upgrade to Professional
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
