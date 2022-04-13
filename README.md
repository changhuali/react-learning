## Fiber 架构

- 背景
  老的架构中，多个渲染任务没有优先级的概念，使得部分紧急的渲染任务可能会被其他不那么紧急的渲染任务阻塞，从而导致用户交互卡顿。
  比如一个模糊搜索页面，当用户输入时，需要同时响应用户输入和搜索结果的渲染，假如搜索结果渲染比较耗时，此时用户输入就无法及时渲染到页面上。
  为了解决上述问题，就需要让渲染任务具有优先级，并且让渲染流程可中断。

  因此`React16`引入了新的架构，新架构分为 3 层：

  - Scheduler --- 负责根据优先级进行任务的调度
  - Reconciler --- 负责 `diff`，并且其处理`虚拟DOM`的过程是可中断的
  - Renderer --- 负责根据 `diff` 结果将组件渲染到页面

- 实现
  `React`中，一个"渲染入口"最多同时存在两个`Fiber`树，已经渲染到屏幕中的内容对应的`Fiber`树称为`current Fiber`树，引发更新时，`React`会在内存中重新构建一棵新的`Fiber`树，称为`workInProgress Fiber`树。
  每个`Fiber`节点有一个`alternate`属性，用于保存其对应的`current Fiber`或`workInProgress Fiber`

下面我们通过分析`React`的`render阶段`和`commit阶段`来见识下`Fiber`在`React`中到底是如何工作的。

## render 阶段

_调用`createRoot`创建一个`ReactDOMRoot`实例_

```ts
function createRoot() {
  // 创建fiberRoot，fiberRoot是整个应用的根节点
  var root = createContainer(
    container,
    ConcurrentRoot,
    null,
    isStrictMode,
    concurrentUpdatesByDefaultOverride,
    identifierPrefix,
    onRecoverableError
  );
  // root会保存到该实例的_internalRoot属性
  return new ReactDOMRoot(root);
}
```

_`createContainer`会调用`createFiberRoot`创建并返回一个`FiberRootNode`实例_

```ts
function createFiberRoot(...略) {
  // 创建fiberRoot
  var root = new FiberRootNode(
    containerInfo,
    tag,
    hydrate,
    identifierPrefix,
    onRecoverableError
  );
  // 创建rootFiber，rootFiber是整个组件树的根节点
  var uninitializedFiber = createHostRootFiber(tag, isStrictMode);
  // 将rootFiber挂载到fiberRoot的current属性上
  root.current = uninitializedFiber;
  uninitializedFiber.stateNode = root;
  return root;
}
```

```ts
const root: FiberRootNode = {
  // ConcurrentRoot === 1 表示开启并发模式
  tag: ConcurrentRoot,
  // container === div#root
  containerInfo: container,
  // 组件对应的Fiber
  current: uninitializedFiber,
};
const uninitializedFiber = {
  // Fiber节点对应的是一个原生节点，其值为3
  tag: HostRoot,
  // 当前渲染模式为并发渲染
  mode: ConcurrentRoot
  // 当前Fiber节点对应的dom信息
  stateNode: root
}
```

`ReactDOMRoot`类有一个`render`实例方法，调用该方法并传入根组件开始渲染

```ts
root.render(<App />);
```

```ts
ReactDOMRoot.prototype.render = function (children) {
  var root = this._internalRoot;
  updateContainer(children, root, null, null);
};
```
