import React from 'react';
import { 
  UtensilsCrossed, 
  Plane, 
  ShoppingBag, 
  Building2, 
  Fuel, 
  Pill, 
  Lightbulb, 
  Film, 
  Package 
} from 'lucide-react';

interface CategoryIconProps {
  category: string | null;
  size?: number;
  className?: string;
}

export function CategoryIcon({ category, size = 16, className }: CategoryIconProps) {
  const normalizedCategory = category?.toLowerCase().trim();

  let Icon = Package;

  switch (normalizedCategory) {
    case 'food':
      Icon = UtensilsCrossed;
      break;
    case 'travel':
      Icon = Plane;
      break;
    case 'shopping':
      Icon = ShoppingBag;
      break;
    case 'stay':
      Icon = Building2;
      break;
    case 'fuel':
      Icon = Fuel;
      break;
    case 'medical':
      Icon = Pill;
      break;
    case 'utilities':
      Icon = Lightbulb;
      break;
    case 'entertainment':
      Icon = Film;
      break;
    default:
      Icon = Package;
  }

  return <Icon size={size} strokeWidth={1.5} className={className} />;
}
