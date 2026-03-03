export abstract class LazyInitializable<TDeps> {
  private _deps?: TDeps;

  init(deps: TDeps): void {
    this._deps = deps;
  }

  /**
   * 取得已初始化的依賴，若尚未呼叫 init() 則拋出錯誤。
   * 使用 getter 讓子類別可明確表達「需要已初始化狀態」，而非依賴難以追蹤的 assertion 副作用。
   */
  protected get deps(): TDeps {
    if (!this._deps) {
      throw new Error(`${this.constructor.name} 尚未初始化，請先呼叫 init()`);
    }
    return this._deps;
  }

  protected ensureInitialized(): void {
    // 觸發 deps getter，若未初始化則拋出錯誤
    void this.deps;
  }
}
