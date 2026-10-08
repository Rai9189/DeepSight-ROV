'use client'

import { useState, useMemo, useEffect } from 'react'
import { toast } from 'sonner'
import { Download, Play, Search, Trash2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Recording {
  id: string
  sessionId: string
  fileName: string
  filePath: string
  fileSize: number
  format: string
  duration: number | null
  createdAt: string
  updatedAt: string
  missionName?: string | null
}

interface RecordingsTableProps {
  recordings: Recording[]
  isAdmin: boolean
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const fmtClock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

// createdAt is written when the recording STOPS, so the start is createdAt − duration
function recordingTimes(rec: Recording) {
  const end = new Date(rec.createdAt)
  if (isNaN(end.getTime())) return null
  const start = rec.duration ? new Date(end.getTime() - rec.duration * 1000) : end
  return { start, end }
}

const missionLabel = (rec: Recording) => rec.missionName || rec.fileName

const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100'

export default function RecordingsTable({ recordings: initialRecordings, isAdmin }: RecordingsTableProps) {
  const [recordings, setRecordings] = useState(initialRecordings)
  useEffect(() => { setRecordings(initialRecordings) }, [initialRecordings])

  const [deleting, setDeleting] = useState<Recording | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [playingVideo, setPlayingVideo] = useState<Recording | null>(null)
  const [videoMissing, setVideoMissing] = useState(false)
  const [search, setSearch] = useState('')
  const [newestFirst, setNewestFirst] = useState(true)

  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? recordings.filter(r => missionLabel(r).toLowerCase().includes(q)) : [...recordings]
    list.sort((a, b) => (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) * (newestFirst ? 1 : -1))
    return list
  }, [recordings, search, newestFirst])

  const confirmDelete = async () => {
    if (!deleting) return
    setIsDeleting(true)
    try {
      await apiClient.delete(`/api/recordings/${deleting.id}`)
      setRecordings(prev => prev.filter(r => r.id !== deleting.id))
      toast.success('Recording deleted')
      setDeleting(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete the recording")
    } finally {
      setIsDeleting(false)
    }
  }

  const openPlayer = (rec: Recording) => { setVideoMissing(false); setPlayingVideo(rec) }
  const handleDownload = (fileName: string) => {
    window.open(`${backendUrl}/api/recordings/download/${fileName}`, '_blank')
  }

  const playingTimes = playingVideo ? recordingTimes(playingVideo) : null

  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search missions…"
            aria-label="Search recordings by mission"
            className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          Sort
          <select
            value={newestFirst ? 'newest' : 'oldest'}
            onChange={e => setNewestFirst(e.target.value === 'newest')}
            className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>
        <span className="ml-auto text-sm text-gray-500">
          {filtered.length} {filtered.length === 1 ? 'recording' : 'recordings'}
        </span>
      </div>

      {/* ── Gallery ── */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 px-6 py-20 text-center">
          <p className="text-base font-semibold text-gray-700">
            {search ? 'No recordings match your search' : 'No recordings yet'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {search ? 'Try a different mission name.' : 'Recordings are saved automatically while you stream a mission.'}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {filtered.map(rec => {
            const t = recordingTimes(rec)
            const name = missionLabel(rec)
            return (
              <li key={rec.id} className="group overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-md">
                <button
                  onClick={() => openPlayer(rec)}
                  aria-label={`Play ${name}`}
                  className="relative block aspect-video w-full bg-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
                >
                  {/* First frame as thumbnail. ponytail: one metadata request per card; switch to server-made thumbnails if the list gets long */}
                  <video
                    src={`${backendUrl}/api/recordings/stream/${rec.fileName}#t=0.5`}
                    preload="metadata"
                    muted
                    playsInline
                    tabIndex={-1}
                    className="pointer-events-none h-full w-full object-cover"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/30">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow transition-transform group-hover:scale-105">
                      <Play className="ml-0.5 h-5 w-5 fill-current" />
                    </span>
                  </span>
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
                    {formatDuration(rec.duration)}
                  </span>
                </button>

                <div className="p-4">
                  <p className="truncate font-medium text-gray-900" title={name}>{name}</p>
                  <p className="mt-0.5 text-sm text-gray-500">
                    {t ? `${fmtDate(t.start)} · ${fmtClock(t.start)}–${fmtClock(t.end)}` : '—'}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-xs text-gray-500">{formatFileSize(rec.fileSize)}</span>
                    <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700">{rec.format.toUpperCase()}</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <button onClick={() => handleDownload(rec.fileName)} aria-label={`Download ${name}`} title="Download" className={`${iconBtn} border-gray-300 text-gray-600 hover:bg-gray-50 hover:text-gray-900`}>
                        <Download className="h-4 w-4" />
                      </button>
                      {isAdmin && (
                        <button onClick={() => setDeleting(rec)} aria-label={`Delete ${name}`} title="Delete" className={`${iconBtn} border-red-200 text-red-600 hover:bg-red-50`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* ── Video player ── */}
      <Dialog open={!!playingVideo} onOpenChange={open => { if (!open) setPlayingVideo(null) }}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">{playingVideo && missionLabel(playingVideo)}</DialogTitle>
            <DialogDescription>
              {playingTimes && `${fmtDate(playingTimes.start)} · ${fmtClock(playingTimes.start)}–${fmtClock(playingTimes.end)} · `}
              {playingVideo && formatDuration(playingVideo.duration)}
            </DialogDescription>
          </DialogHeader>
          {playingVideo && (videoMissing ? (
            <div className="flex aspect-video flex-col items-center justify-center rounded-lg bg-gray-100 px-6 text-center">
              <p className="text-sm font-medium text-gray-700">This recording file is no longer on the server</p>
              <p className="mt-1 text-xs text-gray-500">The entry is still listed, but the video file was moved or deleted.</p>
            </div>
          ) : (
            <video
              controls
              autoPlay
              onError={() => setVideoMissing(true)}
              className="w-full rounded-lg bg-black"
              src={`${backendUrl}/api/recordings/stream/${playingVideo.fileName}`}
            />
          ))}
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation (admin only) ── */}
      <Dialog open={!!deleting} onOpenChange={open => { if (!open && !isDeleting) setDeleting(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Delete recording?</DialogTitle>
            <DialogDescription>
              {deleting && <><span className="font-medium text-gray-900">{missionLabel(deleting)}</span> will be removed and its video file permanently deleted from the server. This can&apos;t be undone.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setDeleting(null)}
              disabled={isDeleting}
              className="h-9 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={isDeleting}
              className="h-9 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-70"
            >
              {isDeleting ? 'Deleting…' : 'Delete recording'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
