'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Layout from '@/components/Layout'
import api from '@/lib/api'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

const punchSchema = z.object({
  employee_email: z.string().email('Invalid email address'),
  pin: z.string().length(4, 'PIN must be 4 digits'),
})

type PunchForm = z.infer<typeof punchSchema>

export default function PunchPage() {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pinDisplay, setPinDisplay] = useState('')

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<PunchForm>({
    resolver: zodResolver(punchSchema),
  })

  const appendPin = (digit: string) => {
    if (pinDisplay.length < 4) {
      const newPin = pinDisplay + digit
      setPinDisplay(newPin)
      setValue('pin', newPin)
    }
  }

  const clearPin = () => {
    setPinDisplay('')
    setValue('pin', '')
  }

  const onSubmit = async (data: PunchForm) => {
    setMessage(null)
    setLoading(true)
    try {
      const response = await api.post('/time/punch', {
        employee_email: data.employee_email,
        pin: data.pin,
        source: 'kiosk',
      })
      const entry = response.data
      if (entry.clock_out_at) {
        setMessage(`Clocked out at ${new Date(entry.clock_out_at).toLocaleString()}`)
      } else {
        setMessage(`Clocked in at ${new Date(entry.clock_in_at).toLocaleString()}`)
      }
      clearPin()
      setTimeout(() => setMessage(null), 3000)
    } catch (err: any) {
      setMessage(err.response?.data?.detail || 'Punch failed. Please try again.')
      clearPin()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-bold text-center mb-6">Punch Kiosk</h1>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {message && (
              <div
                className={`rounded-md p-4 ${
                  message.includes('failed') || message.includes('Invalid')
                    ? 'bg-red-50 text-red-800'
                    : 'bg-green-50 text-green-800'
                }`}
              >
                {message}
              </div>
            )}
            <div>
              <label htmlFor="employee_email" className="block text-sm font-medium text-gray-700">
                Employee Email
              </label>
              <input
                {...register('employee_email')}
                type="email"
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="employee@company.com"
              />
              {errors.employee_email && (
                <p className="mt-1 text-sm text-red-600">{errors.employee_email.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">PIN</label>
              <input
                type="text"
                value={pinDisplay}
                readOnly
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm text-center text-2xl font-mono focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                placeholder="----"
              />
              <input type="hidden" {...register('pin')} />
              {errors.pin && (
                <p className="mt-1 text-sm text-red-600">{errors.pin.message}</p>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => appendPin(num.toString())}
                  className="py-3 px-4 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 text-xl font-semibold"
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={clearPin}
                className="py-3 px-4 border border-gray-300 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => appendPin('0')}
                className="py-3 px-4 border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 text-xl font-semibold"
              >
                0
              </button>
              <button
                type="submit"
                disabled={loading || pinDisplay.length !== 4}
                className="py-3 px-4 border border-transparent rounded-md bg-primary-600 text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 col-span-3"
              >
                {loading ? 'Processing...' : 'Punch'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  )
}

