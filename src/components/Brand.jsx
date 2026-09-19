import { Link } from 'react-router-dom'
import { useGlobalSettings } from '../contexts/GlobalSettingsContext'

export default function Brand({ compact = false, to = '/' }) {
  const { settings } = useGlobalSettings()
  return (
    <Link className={`brand ${compact ? 'brand-compact' : ''}`} to={to} aria-label={`Inicio · ${settings.platformName}`}>
      {settings.logoUrl
        ? <img className="brand-logo" src={settings.logoUrl} alt="" aria-hidden="true" decoding="async" />
        : <img className="brand-logo default-industrial-logo" src="/branding/desafio-industrial-mark.svg" alt="" aria-hidden="true" decoding="async" />}
      {!compact && (
        <span className="brand-copy">
          <strong>{settings.platformName}</strong>
          <small>{settings.platformSubtitle || settings.institutionName}</small>
        </span>
      )}
    </Link>
  )
}
