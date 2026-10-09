import { Geist, Geist_Mono } from 'next/font/google'
import ToasterProvider from '@/components/providers/ToasterProvider'
import './globals.css'

const fontSans = Geist({ subsets: ['latin'], variable: '--font-app-sans' })
const fontMono = Geist_Mono({ subsets: ['latin'], variable: '--font-app-mono' })

export const metadata = {
  // Pages set their own title; the tab reads e.g. "Trends · Carter Island AUV"
  title: { default: 'Carter Island AUV', template: '%s · Carter Island AUV' },
  description: 'Autonomous Underwater Vehicle Control System',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontMono.variable}`}>
      <body className="bg-gray-50 font-sans">
        {children}
        <ToasterProvider />
      </body>
    </html>
  )
}
