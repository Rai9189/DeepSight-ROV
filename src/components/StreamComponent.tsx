'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Settings2 } from 'lucide-react'
import Header from '@/components/layout/Header'
import RovStatus from '@/components/layout/RovStatus'
import SensorCard from '@/components/dashboard/SensorCard'
import { apiClient, isApiStatus } from '@/lib/api-client'
import { getSpeciesColor } from '@/lib/species'
import { WATER_RANGES, SENSOR_LIMITS, getPhStatus, getDoStatus, getTempStatus, getTdsStatus, isDepthNearLimit } from '@/lib/water-quality'
import useSWR from 'swr'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const IFRAME_PREVIEW_URL = process.env.NEXT_PUBLIC_STREAM_PREVIEW_URL || 'http://192.168.2.2:8889/cam/'
const pressable = 'enabled:active:scale-[0.97] transition-[background-color,transform] duration-100'
const API_WS_URL = process.env.NEXT_PUBLIC_API_URL?.replace('http', 'ws') || 'ws://localhost:8000'

type ConnStatus = 'connecting' | 'disconnected' | 'connected' | 'error'
type Profile = 'balanced' | 'ultra'
type Codec = 'h264' | 'vp8'
type SourceMode = 'server' | 'device'

interface ActiveSession { id: string; locationName: string; startTime: string; status: string }
interface SpeciesCount { speciesName: string; totalCount: number }
interface DetectionLog { time: string; species: string; confidence: number; frame: number }
interface PerformanceData { fps?: number; inference_fps?: number; inference_ms?: number; active_ws?: number; model_loaded?: boolean; device?: string }
interface ModelInfo { model_loaded: boolean; device?: string; conf_threshold?: number }

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const NO_VIDEO_SECONDS = 10

const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

const card = 'bg-white rounded-2xl border border-gray-100 shadow-sm'
const inputCls = 'w-full h-10 px-3 border border-gray-300 rounded-lg bg-white text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
const selectCls = 'h-9 border border-gray-300 rounded-lg px-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50 disabled:cursor-not-allowed'

// ── Mission save dialog — shown after Stop. Not dismissible: the mission stays Running until saved.
function MissionSaveDialog({ duration, startedAt, fishCount, onSave, isSaving }: {
  duration: string
  startedAt: string
  fishCount: number
  onSave: (missionName: string, locationName: string) => void
  isSaving?: boolean
}) {
  const [missionName, setMissionName] = useState('')
  const [locationName, setLocationName] = useState('')
  const [errors, setErrors] = useState<{ missionName?: string; locationName?: string }>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!missionName.trim()) errs.missionName = 'Enter a mission name'
    if (!locationName.trim()) errs.locationName = 'Enter a location'
    if (Object.keys(errs).length > 0) { setErrors(errs); return }
    onSave(missionName.trim(), locationName.trim())
  }

  const facts = [
    { label: 'Duration', value: duration },
    { label: 'Started', value: new Date(startedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
    { label: 'Fish detected', value: String(fishCount) },
  ]

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={e => e.preventDefault()}
        onPointerDownOutside={e => e.preventDefault()}
        className="sm:max-w-md gap-0 p-0"
      >
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader className="px-6 pt-6 text-left">
            <DialogTitle className="text-lg font-semibold tracking-tight">Save mission</DialogTitle>
            <DialogDescription>Streaming has stopped. Give this mission a name so you can find it later.</DialogDescription>
          </DialogHeader>

          <dl className="mx-6 mt-5 grid grid-cols-3 divide-x divide-gray-200 rounded-lg border border-gray-200 bg-gray-50">
            {facts.map(f => (
              <div key={f.label} className="px-3 py-2.5">
                <dt className="text-xs text-gray-500">{f.label}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-gray-900">{f.value}</dd>
              </div>
            ))}
          </dl>

          <div className="space-y-4 px-6 pt-5">
            <div className="space-y-1.5">
              <label htmlFor="mission-name" className="text-sm font-medium text-gray-700">Mission name</label>
              <input
                id="mission-name"
                value={missionName}
                onChange={e => { setMissionName(e.target.value); if (errors.missionName) setErrors(p => ({ ...p, missionName: undefined })) }}
                placeholder="e.g. Zone B survey — morning"
                maxLength={120}
                autoFocus
                aria-invalid={!!errors.missionName}
                className={`${inputCls} ${errors.missionName ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`}
              />
              {errors.missionName && <p className="text-xs text-red-600">{errors.missionName}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="mission-location" className="text-sm font-medium text-gray-700">Location</label>
              <input
                id="mission-location"
                value={locationName}
                onChange={e => { setLocationName(e.target.value); if (errors.locationName) setErrors(p => ({ ...p, locationName: undefined })) }}
                placeholder="e.g. Teluk Awur, Zone B"
                maxLength={120}
                aria-invalid={!!errors.locationName}
                className={`${inputCls} ${errors.locationName ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`}
              />
              {errors.locationName && <p className="text-xs text-red-600">{errors.locationName}</p>}
            </div>
          </div>

          <div className="mt-6 flex justify-end border-t border-gray-100 px-6 py-4">
            <button
              type="submit"
              disabled={isSaving}
              className="h-10 px-5 bg-blue-600 hover:bg-blue-700 active:scale-[0.97] disabled:opacity-70 text-white rounded-lg text-sm font-semibold transition-[background-color,transform] duration-100 flex items-center gap-2"
            >
              {isSaving && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {isSaving ? 'Saving…' : 'Save mission'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function StreamComponent() {
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const websocketRef = useRef<WebSocket | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const perfIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const speciesIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null)

  const [isClient, setIsClient] = useState(false)
  // 32 random hex chars (128-bit). getRandomValues, not randomUUID: randomUUID is
  // unavailable over plain-HTTP LAN (HTTPS/localhost only). Backend requires [A-Za-z0-9_-]{8,64}.
  const [clientId] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')
  )
  const [connStatus, setConnStatus] = useState<ConnStatus>('connecting')
  // Set by the Reconnect button so only that action reports success/failure with a toast
  const reconnectRequestedRef = useRef(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const isRecordingRef = useRef(false)
  // True when this Start created the mission (not a resumed one) — a failed start then discards it
  const missionCreatedHereRef = useRef(false)
  const startingRef = useRef(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [showMissionSaveDialog, setShowMissionSaveDialog] = useState(false)
  const [isSavingMission, setIsSavingMission] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [hasVideo, setHasVideo] = useState(false)
  const [noVideoWarning, setNoVideoWarning] = useState(false)

  // Stream settings — locked while streaming
  const [source, setSource] = useState<SourceMode>('server')
  const [profile, setProfile] = useState<Profile>('balanced')
  const [codec, setCodec] = useState<Codec>('h264')
  const [bitrateKbps, setBitrateKbps] = useState(3500)

  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null)
  const [speciesCounts, setSpeciesCounts] = useState<SpeciesCount[]>([])
  const [detectionLogs, setDetectionLogs] = useState<DetectionLog[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [perfData, setPerfData] = useState<PerformanceData | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)

  const liveSessionId = isStreaming ? activeSession?.id : undefined
  const { data: telemetryData } = useSWR(liveSessionId ? `/api/telemetry/latest?session_id=${liveSessionId}` : null, apiClient.swrFetcher, { refreshInterval: 2000 })
  const { data: auvData } = useSWR(liveSessionId ? `/api/auv-status/latest?session_id=${liveSessionId}` : null, apiClient.swrFetcher, { refreshInterval: 2000 })

  const telemetry = (telemetryData as any)?.data
  const auv = (auvData as any)?.data

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [`[${fmtTime(new Date())}] ${msg}`, ...prev.slice(0, 49)])
  }, [])

  useEffect(() => { setIsClient(true) }, [])

  // Mission clock — ticks only while streaming, so it freezes on Stop (and in the save dialog)
  useEffect(() => {
    if (!activeSession || !isStreaming) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [activeSession, isStreaming])

  const fetchActiveSession = useCallback(async () => {
    try {
      const data = await apiClient.get<any>('/api/sessions/active')
      if (data?.data) setActiveSession(data.data)
    } catch { setActiveSession(null) }
  }, [])

  const fetchModelInfo = useCallback(async () => {
    try {
      const data = await apiClient.get<ModelInfo>('/api/model-info')
      setModelInfo(data)
      addLog(`Model loaded: ${data.model_loaded ? 'yes' : 'no'}`)
      if (data.device) addLog(`Device: ${data.device}`)
    } catch { addLog('Failed to fetch model info') }
  }, [addLog])

  useEffect(() => {
    if (!isClient) return
    fetchActiveSession()
    fetchModelInfo()
  }, [isClient, fetchActiveSession, fetchModelInfo])

  // Keep isRecordingRef in sync so WebSocket handlers read the latest value
  useEffect(() => { isRecordingRef.current = isRecording }, [isRecording])

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000)
    } else {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
    }
    return () => { if (recordingTimerRef.current) clearInterval(recordingTimerRef.current) }
  }, [isRecording])

  // Species polling
  useEffect(() => {
    if (!isClient || !isStreaming || !activeSession) {
      if (speciesIntervalRef.current) clearInterval(speciesIntervalRef.current)
      return
    }
    const poll = async () => {
      try {
        const [fishData, detData] = await Promise.all([
          apiClient.get<any>(`/api/fish-counts/session/${activeSession.id}`),
          apiClient.get<any>(`/api/detections?session_id=${activeSession.id}&limit=40`),
        ])
        if (fishData?.data?.counts) setSpeciesCounts(fishData.data.counts)
        if (Array.isArray(detData?.data)) {
          setDetectionLogs(detData.data.map((d: any) => ({
            time: fmtTime(new Date(d.detectedAt)),
            species: d.speciesName,
            confidence: d.confidence,
            frame: d.frameNumber ?? 0,
          })))
        }
      } catch {}
    }
    poll()
    speciesIntervalRef.current = setInterval(poll, 5000)
    return () => { if (speciesIntervalRef.current) clearInterval(speciesIntervalRef.current) }
  }, [isStreaming, activeSession, isClient])

  // Warn when streaming but no frame arrived (e.g. MediaMTX/RTSP not running)
  useEffect(() => {
    if (!isStreaming || hasVideo) { setNoVideoWarning(false); return }
    const id = setTimeout(() => {
      setNoVideoWarning(true)
      addLog(`No video received after ${NO_VIDEO_SECONDS}s — check MediaMTX / the RTSP camera feed`)
    }, NO_VIDEO_SECONDS * 1000)
    return () => clearTimeout(id)
  }, [isStreaming, hasVideo, addLog])

  // Performance polling
  useEffect(() => {
    if (!isStreaming) { if (perfIntervalRef.current) clearInterval(perfIntervalRef.current); return }
    const poll = async () => {
      try { setPerfData(await apiClient.get<PerformanceData>('/api/performance')) } catch {}
    }
    perfIntervalRef.current = setInterval(poll, 3000)
    return () => { if (perfIntervalRef.current) clearInterval(perfIntervalRef.current) }
  }, [isStreaming])

  const initWebRTC = useCallback(async () => {
    try {
      addLog('Init WebRTC...')
      setConnStatus('connecting')
      const ws = new WebSocket(`${API_WS_URL}/ws/${clientId}`)
      websocketRef.current = ws
      ws.onopen = () => {
        setConnStatus('connected')
        addLog('WebSocket connected')
        if (reconnectRequestedRef.current) toast.success('Reconnected to the stream server.')
        reconnectRequestedRef.current = false
      }
      ws.onerror = async () => {
        setConnStatus('error')
        addLog('WebSocket error')
        if (reconnectRequestedRef.current) toast.error("Couldn't reach the stream server. Check that the backend is running.")
        reconnectRequestedRef.current = false
        if (isRecordingRef.current) {
          addLog('Stopping recording because of the connection error...')
          try { await apiClient.post(`/api/recording/stop/${clientId}`) } catch {}
          setIsRecording(false)
          setRecordingSeconds(0)
          setIsStreaming(false)
          toast.error('Connection error. Recording was stopped on the server.')
        }
      }
      ws.onclose = async ev => {
        setConnStatus('disconnected')
        addLog(`WebSocket closed: ${ev.code}`)
        if (isRecordingRef.current) {
          addLog('Stopping recording because the connection was lost...')
          try { await apiClient.post(`/api/recording/stop/${clientId}`) } catch {}
          setIsRecording(false)
          setRecordingSeconds(0)
          setIsStreaming(false)
          toast.error('Connection lost. Recording was stopped on the server.')
        }
      }
      ws.onmessage = async ev => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'error') {
            // Technical detail stays in the System log; the toast says what to check
            addLog(`Backend error: ${msg.message}`)
            toast.error(/404/.test(msg.message)
              ? 'Camera stream not found. Check that the camera is sending video to MediaMTX.'
              : "Couldn't open the camera stream. Check that MediaMTX and the camera are running.")
          } else {
            await handleWsMessage(msg)
          }
        } catch (err) {
          addLog(`WS message error: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], iceCandidatePoolSize: 10 })
      peerConnectionRef.current = pc
      pc.ontrack = ev => {
        if (remoteVideoRef.current && ev.streams[0]) remoteVideoRef.current.srcObject = ev.streams[0]
        addLog('Remote track received')
      }
      pc.onicecandidate = ev => {
        if (ev.candidate && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'ice-candidate', candidate: ev.candidate }))
      }
      pc.onconnectionstatechange = () => addLog(`RTC: ${pc.connectionState}`)
      addLog('WebRTC ready')
    } catch (err) { setConnStatus('error'); addLog(`Init WebRTC failed: ${err instanceof Error ? err.message : String(err)}`) }
  }, [clientId, addLog])

  useEffect(() => {
    if (!isClient) return
    initWebRTC()
    return () => { cleanupStream() }
  }, [isClient])

  const handleWsMessage = async (msg: any) => {
    const pc = peerConnectionRef.current
    if (!pc) return
    if (msg.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: msg.sdp }))
      addLog('Answer received')
    } else if (msg.type === 'ice-candidate' && msg.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(msg.candidate))
    }
  }

  const startStream = async () => {
    // A double click must not start twice: the button stays until the stream is up
    if (startingRef.current) return
    startingRef.current = true
    try {
      const autoLabel = `Mission — ${new Date().toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`

      // Create the mission with a temporary name; the user names it after Stop
      let session = activeSession
      if (!session) {
        try {
          const sessionRes = await apiClient.post<any>('/api/sessions', { locationName: autoLabel })
          if (sessionRes?.data) {
            session = sessionRes.data
            setActiveSession(sessionRes.data)
            missionCreatedHereRef.current = true
            addLog(`Mission created: ...${sessionRes.data.id.slice(-6)}`)
          }
        } catch (e: any) {
          // 409 = a mission is already running → continue that one
          if (isApiStatus(e, 409)) {
            try {
              const activeData = await apiClient.get<any>('/api/sessions/active')
              if (activeData?.data) {
                session = activeData.data
                setActiveSession(activeData.data)
                addLog(`Continuing running mission: ...${activeData.data.id.slice(-6)}`)
              }
            } catch {
              toast.error("Couldn't load the running mission. Try again.")
              return
            }
          } else {
            addLog(`Failed to create mission: ${e?.message || ''}`)
            toast.error("Couldn't create the mission. Try again.")
            return
          }
        }
      }

      await handleStartStream(session)
    } finally {
      startingRef.current = false
    }
  }

  const handleStartStream = async (session: ActiveSession | null) => {
    // Start WebRTC once the mission exists
    setHasVideo(false)
    try {
      const pc = peerConnectionRef.current
      if (!pc) return
      addLog(`Start stream — source=${source}, codec=${codec}, profile=${profile}, bitrate=${bitrateKbps}kbps${session ? '' : ' (no mission)'}`)
      if (source === 'server') {
        pc.addTransceiver('video', { direction: 'recvonly' })
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        localStreamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
        stream.getTracks().forEach(t => pc.addTrack(t, stream))
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const ws = websocketRef.current
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'offer', sdp: offer.sdp, profile, codec, maxBitrateKbps: bitrateKbps }))
        addLog('Offer sent')
        setIsStreaming(true)

        // Auto-start recording — give the WebRTC handshake a moment first
        setTimeout(async () => {
          try {
            const recData = await apiClient.post<any>(`/api/recording/start/${clientId}`)
            if (recData.success) {
              setIsRecording(true)
              addLog('Recording started')
            } else {
              addLog(`Recording didn't start: ${recData.error}`)
            }
          } catch {
            addLog('Recording failed to start — stream keeps running')
          }
        }, 1500)
      } else {
        addLog('Stream start failed: WebSocket not ready')
        toast.error('Not connected yet. Wait until the status is Connected, then try again.')
      }
    } catch (e: any) {
      addLog(`Start failed: ${e?.message}`)
      toast.error(`Couldn't start the stream: ${e?.message}`)
    }
  }

  const cleanupStream = () => {
    // Null every handler before closing so stale onclose/onerror events
    // don't overwrite the status of the next WebSocket
    if (websocketRef.current) {
      websocketRef.current.onopen = null
      websocketRef.current.onerror = null
      websocketRef.current.onclose = null
      websocketRef.current.onmessage = null
      websocketRef.current.close()
      websocketRef.current = null
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.ontrack = null
      peerConnectionRef.current.onicecandidate = null
      peerConnectionRef.current.onconnectionstatechange = null
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    if (perfIntervalRef.current) clearInterval(perfIntervalRef.current)
  }

  const stopStream = async () => {
    addLog('Stopping stream...')

    if (isRecording) {
      try { await apiClient.post(`/api/recording/stop/${clientId}`) } catch {}
      setIsRecording(false)
    }

    cleanupStream()
    setIsStreaming(false)
    setHasVideo(false)
    setConnStatus('disconnected')
    setPerfData(null)

    if (activeSession && !hasVideo && missionCreatedHereRef.current) {
      // No frame ever arrived: nothing worth saving, so close the mission instead of asking for a name
      try { await apiClient.patch(`/api/sessions/${activeSession.id}`, { status: 'Aborted' }) } catch {}
      toast.warning('No video was received, so the mission was closed as Aborted. Check MediaMTX and the camera, then start again.')
      addLog('No video received — mission closed as Aborted')
      resetAfterMission()
    } else if (activeSession) {
      setNow(Date.now())
      setShowMissionSaveDialog(true)
    } else {
      setRecordingSeconds(0)
      setSpeciesCounts([])
      setDetectionLogs([])
      addLog('Stream stopped')
      setTimeout(() => { initWebRTC(); fetchActiveSession() }, 300)
    }
  }

  const handleSaveMission = async (missionName: string, locationName: string) => {
    if (!activeSession) return
    setIsSavingMission(true)
    try {
      await apiClient.patch(`/api/sessions/${activeSession.id}`, {
        status: 'Completed',
        locationName: `${missionName} — ${locationName}`,
      })
      toast.success(`Mission "${missionName}" saved.`)
      addLog(`Mission saved: ${missionName} — ${locationName}`)
      setShowMissionSaveDialog(false)
      resetAfterMission()
    } catch {
      // Keep the dialog open: closing it would drop the name and leave the mission Running
      toast.error("Couldn't save the mission. Try again.")
    } finally {
      setIsSavingMission(false)
    }
  }

  const resetAfterMission = () => {
    missionCreatedHereRef.current = false
    setActiveSession(null)
    setSpeciesCounts([])
    setDetectionLogs([])
    setRecordingSeconds(0)
    addLog('Stream stopped')
    setTimeout(() => { initWebRTC(); fetchActiveSession() }, 300)
  }

  const totalFish = speciesCounts.reduce((s, c) => s + c.totalCount, 0)
  const missionSeconds = activeSession
    ? Math.max(0, Math.floor((now - new Date(activeSession.startTime).getTime()) / 1000))
    : 0
  const inferenceMs = perfData?.inference_ms || null
  const aiReady = !!modelInfo?.model_loaded

  const conn = {
    connecting:   { dot: 'bg-amber-400 motion-safe:animate-pulse', text: 'Connecting…' },
    connected:    { dot: 'bg-green-500', text: 'Connected' },
    error:        { dot: 'bg-red-500',   text: 'Connection error' },
    disconnected: { dot: 'bg-gray-300',  text: 'Disconnected' },
  }[connStatus]

  const chips = isStreaming ? [
    auv?.depth != null && `Depth ${auv.depth.toFixed(1)} m${isDepthNearLimit(auv.depth) ? ' · near sensor limit' : ''}`,
    !!perfData?.fps && `FPS ${perfData.fps.toFixed(0)}`, // 0 = belum terukur → chip disembunyikan
    inferenceMs != null && `Inference ${inferenceMs.toFixed(0)} ms`,
    modelInfo?.conf_threshold != null && `Conf ≥ ${modelInfo.conf_threshold}`,
  ].filter(Boolean) as string[] : []

  if (!isClient) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="Live Stream" subtitle="Real-time camera feed and fish detection">
        <RovStatus />
      </Header>

      {showMissionSaveDialog && activeSession && (
        <MissionSaveDialog
          duration={formatDuration(missionSeconds)}
          startedAt={activeSession.startTime}
          fishCount={totalFish}
          onSave={handleSaveMission}
          isSaving={isSavingMission}
        />
      )}

      <main className="px-4 py-4 lg:px-6 space-y-4">

        {/* ── Control bar ── */}
        <div className={card}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                <span className={`h-2 w-2 rounded-full ${conn.dot}`} />
                {conn.text}
              </span>
              {activeSession && (
                <span className="truncate text-gray-500">
                  {activeSession.locationName} · {formatDuration(missionSeconds)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isStreaming && (
                <span className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium ${isRecording ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                  <span className={`h-2 w-2 rounded-full ${isRecording ? 'bg-red-500 motion-safe:animate-pulse' : 'bg-gray-300'}`} />
                  {isRecording ? `REC ${formatDuration(recordingSeconds)}` : 'Starting recording…'}
                </span>
              )}
              <button
                onClick={() => {
                  reconnectRequestedRef.current = true
                  addLog('Reconnecting...')
                  cleanupStream()
                  setConnStatus('connecting')
                  setTimeout(initWebRTC, 300)
                }}
                disabled={isStreaming || connStatus === 'connecting'}
                title="Reconnect to the stream server"
                className={`h-9 px-3 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed ${pressable}`}
              >
                Reconnect
              </button>
              {!isStreaming ? (
                <button
                  onClick={startStream}
                  disabled={connStatus !== 'connected'}
                  className={`h-9 px-4 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500 text-white rounded-lg ${pressable}`}
                >
                  Start stream
                </button>
              ) : (
                <button
                  onClick={stopStream}
                  className={`h-9 px-4 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg ${pressable}`}
                >
                  Stop
                </button>
              )}
            </div>
          </div>

          {/* Stream settings (folded) */}
          <div className="border-t border-gray-100 px-5">
            <button
              onClick={() => setShowSettings(v => !v)}
              aria-expanded={showSettings}
              className="flex w-full items-center gap-2 py-2.5 text-sm text-gray-600 hover:text-gray-900"
            >
              <Settings2 className="h-4 w-4" />
              Stream settings
              <span className="text-gray-400">
                · {source === 'server' ? 'ROV camera' : 'This device'} · {codec.toUpperCase()} · {bitrateKbps} kbps
              </span>
              <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${showSettings ? 'rotate-180' : ''}`} />
            </button>
            <div
              inert={!showSettings}
              className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${showSettings ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              {/* Negative margin leaves room for the focus rings the clip would cut */}
              <div className="-mx-1 overflow-hidden px-1">
              <div className="flex flex-wrap items-end gap-4 pb-4 pt-1">
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-500">Source</span>
                  <select value={source} onChange={e => setSource(e.target.value as SourceMode)} disabled={isStreaming} className={selectCls}>
                    <option value="server">ROV camera (RTSP)</option>
                    <option value="device">This device&apos;s camera</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-500">Profile</span>
                  <select value={profile} onChange={e => setProfile(e.target.value as Profile)} disabled={isStreaming} className={selectCls}>
                    <option value="balanced">Balanced (TCP)</option>
                    <option value="ultra">Ultra-low latency (UDP)</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-500">Codec</span>
                  <select value={codec} onChange={e => setCodec(e.target.value as Codec)} disabled={isStreaming} className={selectCls}>
                    <option value="h264">H.264</option>
                    <option value="vp8">VP8</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-500">Bitrate (kbps)</span>
                  <input
                    type="number" min={500} max={12000} step={100}
                    value={bitrateKbps}
                    onChange={e => setBitrateKbps(Number(e.target.value))}
                    disabled={isStreaming}
                    className={`${selectCls} w-28`}
                  />
                </label>
                {isStreaming && <p className="pb-2 text-xs text-gray-500">Locked while streaming</p>}
              </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Detection feed + fish count ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`lg:col-span-2 ${card} overflow-hidden`}>
            <div className="flex items-center justify-between px-5 py-3">
              <h2 className="text-base font-semibold text-gray-900">Detection feed</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                isStreaming && aiReady ? 'bg-green-50 text-green-700' : aiReady ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-500'
              }`}>
                {isStreaming && aiReady ? 'AI active' : aiReady ? 'AI ready' : 'AI off'}
              </span>
            </div>
            <div className="relative bg-gray-900 aspect-video">
              <video ref={remoteVideoRef} autoPlay playsInline onLoadedData={() => setHasVideo(true)} className="w-full h-full object-contain" />
              {noVideoWarning && (
                <div role="alert" className="animate-in fade-in duration-200 absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
                  <span className="text-sm font-medium text-amber-300">No video received</span>
                  <span className="text-xs text-gray-400">
                    {source === 'server'
                      ? 'Check that MediaMTX and the ROV camera (RTSP) are running, then stop and start again.'
                      : 'Check that this device’s camera is available.'}
                  </span>
                </div>
              )}
              {!isStreaming && (
                <div className="animate-in fade-in duration-200 absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
                  <span className="text-sm font-medium text-gray-300">No stream</span>
                  <span className="text-xs text-gray-500">
                    {connStatus === 'connected'
                      ? `Press Start stream to view the ${source === 'server' ? 'ROV camera' : 'device camera'} with fish detection.`
                      : 'Waiting for the stream server connection.'}
                  </span>
                </div>
              )}
              {chips.length > 0 && (
                <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                  {chips.map(c => (
                    <span key={c} className="rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white">{c}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-xs text-gray-500">
              <span>Model device: {modelInfo?.device ?? '—'}</span>
              <button onClick={() => setShowPreview(v => !v)} aria-expanded={showPreview} className="inline-flex items-center gap-1 font-medium text-gray-600 hover:text-gray-900">
                Raw camera preview
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showPreview ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {/* The device <video> stays mounted so the camera stream can attach while the preview is folded */}
            <div className={showPreview ? 'border-t border-gray-100 p-3' : 'hidden'}>
              <div className="relative bg-gray-900 aspect-video rounded-lg overflow-hidden">
                {source === 'device' ? (
                  <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-contain" />
                ) : showPreview && isStreaming ? (
                  <iframe src={IFRAME_PREVIEW_URL} title="Raw camera preview" className="w-full h-full" allow="autoplay; encrypted-media" allowFullScreen />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-500">Preview appears while streaming</div>
                )}
              </div>
            </div>
          </div>

          {/* Fish count + recent detections */}
          <div data-testid="fish-card" className={`${card} p-5 flex flex-col ${showPreview && detectionLogs.length === 0 ? 'lg:self-start' : ''}`}>
            <h2 className="text-base font-semibold text-gray-900">Fish counted</h2>
            <p className="text-xs text-gray-500">Most seen in a single frame, this mission</p>
            <p className="mt-2 text-4xl font-semibold tracking-tight text-gray-900">{totalFish}</p>
            {/* Only labels the AI really reports: a placeholder species list switched to "ikan" mid-stream */}
            {speciesCounts.length === 0 ? <p className="mt-4 text-sm text-gray-500">No fish detected yet</p> : (
            <div className="mt-4 space-y-2.5">
              {speciesCounts.map((s, i) => (
                <div key={s.speciesName} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-gray-700">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: getSpeciesColor(s.speciesName) }} />
                      {s.speciesName}
                    </span>
                    <span className="font-medium text-gray-900">{s.totalCount}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${totalFish > 0 ? (s.totalCount / totalFish) * 100 : 0}%`, backgroundColor: getSpeciesColor(s.speciesName) }} />
                  </div>
                </div>
              ))}
            </div>
            )}

            <h3 className="mt-6 text-sm font-semibold text-gray-900">Recent detections</h3>
            {detectionLogs.length > 0 ? (
              // Absolute on desktop so the list fills the card without making the row taller
              <div className="relative mt-2 flex-1 lg:min-h-64">
                <ul data-testid="recent-detections" className="max-h-64 divide-y divide-gray-100 overflow-y-auto text-sm lg:absolute lg:inset-0 lg:max-h-none">
                  {detectionLogs.map((log, i) => (
                    <li key={i} className="flex items-center gap-3 py-2">
                      <span className="text-xs text-gray-500">{log.time}</span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 text-gray-700">
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: getSpeciesColor(log.species) }} />
                        <span className="truncate">{log.species}</span>
                      </span>
                      <span className="text-xs font-medium text-gray-900">{(log.confidence * 100).toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">{isStreaming ? 'No fish detected yet.' : 'Detections appear here while streaming.'}</p>
            )}
          </div>
        </div>

        {/* ── Water quality ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SensorCard label="pH" value={telemetry?.phLevel} unit="pH" status={getPhStatus} hint={`Normal ${WATER_RANGES.ph.text}`} />
          <SensorCard label="TDS" value={telemetry?.tdsValue} unit="ppm" status={getTdsStatus} hint={`Sensor limit ${SENSOR_LIMITS.tds.toLocaleString('en-US')} ppm`} />
          <SensorCard label="Dissolved oxygen" value={telemetry?.dissolvedOxygen} unit="mg/L" status={getDoStatus} hint={`Normal ${WATER_RANGES.do.text}`} />
          <SensorCard label="Water temperature" value={telemetry?.waterTemp} unit="°C" status={getTempStatus} hint={`Normal ${WATER_RANGES.temp.text}`} />
        </div>

        {/* ── System log (folded) ── */}
        <div className={card}>
          <div className="flex items-center justify-between px-5">
            <button onClick={() => setShowLogs(v => !v)} aria-expanded={showLogs} className="flex flex-1 items-center gap-2 py-3 text-sm font-medium text-gray-700 hover:text-gray-900">
              System log <span className="font-normal text-gray-400">({logs.length})</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showLogs ? 'rotate-180' : ''}`} />
            </button>
            {showLogs && logs.length > 0 && (
              <button onClick={() => setLogs([])} className="text-xs font-medium text-gray-500 hover:text-gray-700">Clear</button>
            )}
          </div>
          {showLogs && (
            <div className="mx-5 mb-5 max-h-72 overflow-y-auto rounded-lg bg-gray-50 p-3 font-mono text-xs leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
              {logs.length > 0 ? logs.map((l, i) => (
                <div key={i} className={/fail|error|lost|didn't/i.test(l) ? 'text-red-600' : 'text-gray-700'}>{l}</div>
              )) : <div className="text-gray-400">No log entries</div>}
            </div>
          )}
        </div>

      </main>
    </div>
  )
}
