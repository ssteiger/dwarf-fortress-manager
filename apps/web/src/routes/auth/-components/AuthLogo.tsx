import { Link } from '@tanstack/react-router'
import { PickaxeIcon } from 'lucide-react'

export function AuthLogo() {
  return (
    <Link to="/" aria-label="Go home" className="flex items-center gap-2">
      <PickaxeIcon className="h-6 w-6 text-foreground" aria-hidden="true" />
      <span className="font-heading text-base font-semibold tracking-tight">Dwarf Fortress Manager</span>
    </Link>
  )
}
