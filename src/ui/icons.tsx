import {
  Bike, BookOpen, Briefcase, Camera, Car, Code, Coffee, CreditCard, Dumbbell, Film, Flame, Footprints, Gamepad2, Globe,
  GraduationCap, Guitar, Headphones, Heart, House, Inbox, Laptop, Leaf, Mic, Music, Palette, PawPrint, Piano, Plane,
  ShoppingCart, Sparkles, Star, User, UtensilsCrossed,
} from 'lucide-preact'
import type { LucideIcon } from 'lucide-preact'

type Icon = LucideIcon

/** Значки разделов: имена как в SF Symbols на Mac → значки Lucide */
const map: Record<string, Icon> = {
  'graduationcap.fill': GraduationCap,
  'music.note': Music,
  'person.fill': User,
  'figure.run': Footprints,
  'briefcase.fill': Briefcase,
  'house.fill': House,
  'heart.fill': Heart,
  'creditcard.fill': CreditCard,
  airplane: Plane,
  'paintpalette.fill': Palette,
  'gamecontroller.fill': Gamepad2,
  'book.fill': BookOpen,
  'camera.fill': Camera,
  film: Film,
  'mic.fill': Mic,
  headphones: Headphones,
  'guitars.fill': Guitar,
  pianokeys: Piano,
  'dumbbell.fill': Dumbbell,
  bicycle: Bike,
  'car.fill': Car,
  'cart.fill': ShoppingCart,
  'leaf.fill': Leaf,
  'pawprint.fill': PawPrint,
  'cup.and.saucer.fill': Coffee,
  'fork.knife': UtensilsCrossed,
  laptopcomputer: Laptop,
  'chevron.left.forwardslash.chevron.right': Code,
  'star.fill': Star,
  'flame.fill': Flame,
  globe: Globe,
  sparkles: Sparkles,
  tray: Inbox,
}

export const areaIcons = Object.keys(map).filter((k) => k !== 'tray')

export function AreaIcon({ name, size = 14, color }: { name: string; size?: number; color?: string }) {
  const C = map[name] ?? Sparkles
  return <C size={size} strokeWidth={2.4} color={color} />
}
