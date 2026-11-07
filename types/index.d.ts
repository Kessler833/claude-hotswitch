export type Account = { name: string; label: string }
export type Accounts = { active: string; locale: string; accounts: Account[] }

declare module 'claude-code' {
  interface PluginState {
    'hotswitch': {
      accounts: Shaped<Accounts>
      status: Shaped<string>
      who: Shaped<string>
      open: Shaped<boolean>
      confirmRemove: Shaped<string>
    }
  }
}
