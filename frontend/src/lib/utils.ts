import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** 合併 Tailwind CSS 類別名稱，並透過 tailwind-merge 解決衝突 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
}
