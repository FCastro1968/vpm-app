export default function NotificationsPage() {
  const items = [
    { label: 'Survey submitted',  description: 'When a distributed respondent submits their survey.' },
    { label: 'Model ready',       description: 'When a solver run completes and results are available.' },
    { label: 'Export complete',   description: 'When a PDF or data export finishes generating.' },
  ]

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Notifications</h1>
      <section className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {items.map(({ label, description }) => (
          <div key={label} className="flex items-start justify-between px-6 py-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{description}</p>
            </div>
            <label className="relative inline-flex items-center cursor-not-allowed ml-6 mt-0.5">
              <input type="checkbox" className="sr-only" disabled />
              <div className="w-9 h-5 bg-gray-200 rounded-full" />
              <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow" />
            </label>
          </div>
        ))}
        <p className="px-6 py-3 text-xs text-gray-400">Email notification preferences will be available when transactional email is fully configured.</p>
      </section>
    </div>
  )
}
