import { Context } from '@deepseek-ai/cordis';
import type { RegistrationLease, TableRegistration } from '../../contracts/tables.js';
export declare function serviceIsolation(contextScope: Context, service: string): symbol;
interface Entry<Value> {
    readonly value: Value;
    readonly order: number;
    readonly lease: RegistrationLease;
}
interface Ordering<Value> {
    order(value: Value): number;
    overlaps?(left: Value, right: Value): boolean;
}
export declare class RegistrationTable<Value> {
    private readonly ordering?;
    private readonly registrations;
    constructor(ordering?: Ordering<Value> | undefined);
    register(key: string, value: Value): TableRegistration;
    get(key: string): Entry<Value> | undefined;
    entries(): readonly Entry<Value>[];
}
export {};
