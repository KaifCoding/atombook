'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db, loadBusiness, loadDesign } from './db';
import type { Business, Customer, DesignConfig, Doc, Item } from './types';

/** undefined while loading */
export function useBusiness(): Business | undefined {
  return useLiveQuery(() => loadBusiness(), []);
}

export function useDesign(): DesignConfig | undefined {
  return useLiveQuery(() => loadDesign(), []);
}

export function useDocs(): Doc[] | undefined {
  return useLiveQuery(() => db.docs.orderBy('id').reverse().toArray(), []);
}

export function useCustomers(): Customer[] | undefined {
  return useLiveQuery(() => db.customers.orderBy('name').toArray(), []);
}

export function useItems(): Item[] | undefined {
  return useLiveQuery(() => db.items.orderBy('name').toArray(), []);
}
