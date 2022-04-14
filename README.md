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
  // 整个组件树的根节点
  current: uninitializedFiber,
};
const uninitializedFiber = {
  // Fiber节点对应的是一个原生节点，其值为3
  tag: HostRoot,
  // 渲染模式为并发渲染
  mode: ConcurrentRoot
  // Fiber节点对应的dom信息
  stateNode: root
}
```

_`ReactDOMRoot`类有一个`render`实例方法，调用该方法会开始渲染组件树_

```ts
root.render(<App />);
```

```ts
ReactDOMRoot.prototype.render = function (children) {
  var root = this._internalRoot;
  updateContainer(children, root, null, null);
};
```

_`updateContainer`_

```ts
function updateContainer(element, container, parentComponent, callback) {
  var current$1 = container.current;
  var eventTime = requestEventTime();
  var lane = requestUpdateLane(current$1);
  // 创建Update对象
  var update = createUpdate(eventTime, lane);
  update.payload = {
    element: element,
  };

  // 将Update对象入队到current Fiber对象的updateQueue队列
  enqueueUpdate(current$1, update);
  var root = scheduleUpdateOnFiber(current$1, lane, eventTime);

  return lane;
}
```

_`scheduleUpdateOnFiber`_

```ts
function scheduleUpdateOnFiber(fiber, lane, eventTime) {
  ensureRootIsScheduled(root, eventTime);

  return root;
}
```

_`ensureRootIsScheduled`_

```ts
function ensureRootIsScheduled(root, currentTime) {
  // 获取root的优先级
  var nextLanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes
  );
  var newCallbackPriority = getHighestPriorityLane(nextLanes);
  // 优先级为SyncLane，进入微任务队列（基于queueMocrotask或Promise）
  if (newCallbackPriority === SyncLane) {
    // 将performSyncWorkOnRoot.bind(null, root)回调函数加入到全局syncQueue队列
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));
    if (ReactCurrentActQueue$1.current !== null) {
      // TODO:如何理解 Inside `act`, use our internal `act` queue so that these get flushed
      // at the end of the current scope even when using the sync version
      // of `act`.
      ReactCurrentActQueue$1.current.push(flushSyncCallbacks);
    } else {
      scheduleMicrotask(function () {
        if (executionContext === NoContext) {
          flushSyncCallbacks();
        }
      });
    }
  } else {
    // 优先级低于SyncLane，进入宏任务队列（基于setImmediate或MessageChanel）
    // scheduleCallback$2会根据当前ReactCurrentActQueue$1.current队列是否为空分别处理该任务
    // ReactCurrentActQueue$1.current不为空(TODO:何时不为空)：该任务将继续入ReactCurrentActQueue$1.current
    // ReactCurrentActQueue$1.current为空：该任务将通过Scheduler入堆（该堆是通过根据expirationTime排序的小顶堆）
    newCallbackNode = scheduleCallback$2(
      schedulerPriorityLevel,
      performConcurrentWorkOnRoot.bind(null, root)
    );
  }
}
```

小结：`ensureRootIsScheduled`会根据更新的优先级生成异步任务，优先级最高的同步任务（`SyncLane`）会以`微任务`的方式执行，其他优先级的任务均会以`宏任务`的方式按照`expirationTime`从小到大的顺序执行

`ensureRootIsScheduled`执行完成后，异步任务开始，此时会执行`performConcurrentWorkOnRoot`

`performConcurrentWorkOnRoot`内部会判断当前是走`并发模式`还是`同步模式`，此时由于是初次渲染，因此会走`同步模式`进而调用`renderRootSync`

`renderRootSync`

```ts
function renderRootSync(root, lanes) {
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    // 初始化workInProgressRoot、workInProgress、workInProgressRootRenderLanes等
    // 一些全局变量，为workLoopSync的执行做准备
    prepareFreshStack(root, lanes);
    workLoopSync();
  }
}
```

`workLoopSync`

```ts
// 开始处理workInProgress Fiber，从rootFiber开始
function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}
```

`performUnitOfWork`

```ts
function performUnitOfWork(unitOfWork) {
  var current = unitOfWork.alternate;
  next = beginWork$1(current, unitOfWork, subtreeRenderLanes);
  if (next === null) {
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}
```

`beginWork`

```ts
function beginWork(current, workInProgress, renderLanes) {
  // update
  if (current !== null) {
    var oldProps = current.memoizedProps;
    var newProps = workInProgress.pendingProps;

    if (
      oldProps !== newProps ||
      hasContextChanged() || // Force a re-render if the implementation changed due to hot reload:
      workInProgress.type !== current.type
    ) {
      didReceiveUpdate = true;
    } else {
      // In case: oldProps === newProps && !hasContextChanged() && workInProgress.type === current.type
      var hasScheduledUpdateOrContext = checkScheduledUpdateOrContext(
        current,
        renderLanes
      );

      // TODO:何时触发》？
      // 优化点：直接复用子`Fiber`
      if (
        !hasScheduledUpdateOrContext &&
        (workInProgress.flags & DidCapture) === NoFlags
      ) {
        didReceiveUpdate = false;
        return attemptEarlyBailoutIfNoScheduledUpdate(
          current,
          workInProgress,
          renderLanes
        );
      }

      if ((current.flags & ForceUpdateForLegacySuspense) !== NoFlags) {
        didReceiveUpdate = true;
      } else {
        didReceiveUpdate = false;
      }
    }
  } else {
    // mount
    didReceiveUpdate = false;

    if (getIsHydrating() && isForkedChild(workInProgress)) {
      var slotIndex = workInProgress.index;
      var numberOfForks = getForksAtLevel();
      pushTreeId(workInProgress, numberOfForks, slotIndex);
    }
  }

  workInProgress.lanes = NoLanes;

  switch (workInProgress.tag) {
    // 根据tag（表示节点类型）的值创建各自对应的Fiber
    case IndeterminateComponent:

    case LazyComponent:

    case FunctionComponent:

    case ClassComponent:

    case HostRoot:
      return updateHostRoot(current, workInProgress, renderLanes);
    case HostComponent:

    case HostText:

    case SuspenseComponent:

    case HostPortal:

    case ForwardRef:

    case Fragment:

    case Mode:

    case Profiler:

    case ContextProvider:

    case ContextConsumer:

    case MemoComponent:

    case SimpleMemoComponent:

    case IncompleteClassComponent:

    case SuspenseListComponent:

    case ScopeComponent: {
      break;
    }

    case OffscreenComponent:

    case LegacyHiddenComponent: {
      break;
    }

    case CacheComponent:
  }
}
```

`updateHostRoot`

```ts
function updateHostRoot(current, workInProgress, renderLanes) {
  var prevState = workInProgress.memoizedState;
  var prevChildren = prevState.element;
  // 将current.updateQueue拷贝到workInProgress.updateQueue
  cloneUpdateQueue(current, workInProgress);
  // 处理所有的update queue
  processUpdateQueue(workInProgress, nextProps, null, renderLanes);
  var nextState = workInProgress.memoizedState;
  var nextChildren = nextState.element;

  // 优化: 此次渲染的children和上次渲染的children相同，则跳过，由此可见日常编程中可以用useMemo包裹children做优化
  if (nextChildren === prevChildren) {
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes);
  }

  // 创建workInProgress Fiber的子节点
  reconcileChildren(current, workInProgress, nextChildren, renderLanes);

  // 返回创建好的子节点
  return workInProgress.child;
}
```

`processUpdateQueue`

```ts
function processUpdateQueue(workInProgress, props, instance, renderLanes) {
  var queue = workInProgress.updateQueue;
  var firstBaseUpdate = queue.firstBaseUpdate;
  var lastBaseUpdate = queue.lastBaseUpdate;

  var pendingQueue = queue.shared.pending;
  // Check if there are pending updates. If so, transfer them to the base queue.
  if (pendingQueue !== null) {
    // TODO:为何要设置为null
    queue.shared.pending = null;

    // pending queue是个环形链表，下面这个操作会将环剪开，让其变为一个普通链表
    var lastPendingUpdate = pendingQueue;
    var firstPendingUpdate = lastPendingUpdate.next;
    lastPendingUpdate.next = null;

    // 将剪开后的pending queue挂载到base queue上面
    if (lastBaseUpdate === null) {
      firstBaseUpdate = firstPendingUpdate;
    } else {
      lastBaseUpdate.next = firstPendingUpdate;
    }
    lastBaseUpdate = lastPendingUpdate;

    // 将pending queue同步到current的base queue，防止中断导致current Fiber的pending queue丢失
    var current = workInProgress.alternate;
    if (current !== null) {
      var currentQueue = current.updateQueue;
      var currentLastBaseUpdate = currentQueue.lastBaseUpdate;

      if (currentLastBaseUpdate !== lastBaseUpdate) {
        if (currentLastBaseUpdate === null) {
          currentQueue.firstBaseUpdate = firstPendingUpdate;
        } else {
          currentLastBaseUpdate.next = firstPendingUpdate;
        }

        currentQueue.lastBaseUpdate = lastPendingUpdate;
      }
    }
  }

  if (firstBaseUpdate !== null) {
    // Iterate through the list of updates to compute the result.
    var newState = queue.baseState;

    var newLanes = NoLanes;
    var newBaseState = null;
    var newFirstBaseUpdate = null;
    var newLastBaseUpdate = null;
    var update = firstBaseUpdate;

    do {
      var updateLane = update.lane;
      var updateEventTime = update.eventTime;

      // update优先级不满足调度优先级
      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        var clone = {
          eventTime: updateEventTime,
          lane: updateLane,
          tag: update.tag,
          payload: update.payload,
          callback: update.callback,
          next: null,
        };

        // 将update加入到新的base queue
        if (newLastBaseUpdate === null) {
          newFirstBaseUpdate = newLastBaseUpdate = clone;
          newBaseState = newState;
        } else {
          newLastBaseUpdate = newLastBaseUpdate.next = clone;
        }

        // TODO:作用 Update the remaining priority in the queue.
        newLanes = mergeLanes(newLanes, updateLane);
      } else {
        // This update does have sufficient priority.
        // 如果新的base queue不为空，说明之前有update由于优先级不够被跳过，那么此update也应该被跳过，以保证update之间状态的连续性。
        if (newLastBaseUpdate !== null) {
          var _clone = {
            eventTime: updateEventTime,
            // This update is going to be committed so we never want uncommit
            // it. Using NoLane works because 0 is a subset of all bitmasks, so
            // this will never be skipped by the check above.
            lane: NoLane,
            tag: update.tag,
            payload: update.payload,
            callback: update.callback,
            next: null,
          };
          newLastBaseUpdate = newLastBaseUpdate.next = _clone;
        }

        // Process this update.
        // 将baseState视为prev state，然后根据prev state和update计算出新的state
        newState = getStateFromUpdate(
          workInProgress,
          queue,
          update,
          newState,
          props,
          instance
        );

        // 将含有callback的update保存到update queue的effects中
        var callback = update.callback;
        if (
          callback !== null && // If the update was already committed, we should not queue its
          // callback again.
          update.lane !== NoLane
        ) {
          workInProgress.flags |= Callback;
          var effects = queue.effects;

          if (effects === null) {
            queue.effects = [update];
          } else {
            effects.push(update);
          }
        }
      }

      update = update.next;

      if (update === null) {
        pendingQueue = queue.shared.pending;

        if (pendingQueue === null) {
          break;
        } else {
          // An update was scheduled from inside a reducer（TODO:哪种情况）. Add the new
          // pending updates to the end of the list and keep processing.
          var _lastPendingUpdate = pendingQueue; // Intentionally unsound. Pending updates form a circular list, but we
          // unravel them when transferring them to the base queue.

          var _firstPendingUpdate = _lastPendingUpdate.next;
          _lastPendingUpdate.next = null;
          update = _firstPendingUpdate;
          queue.lastBaseUpdate = _lastPendingUpdate;
          queue.shared.pending = null;
        }
      }
    } while (true);

    // 没有update被跳过
    if (newLastBaseUpdate === null) {
      newBaseState = newState;
    }

    queue.baseState = newBaseState;
    queue.firstBaseUpdate = newFirstBaseUpdate;
    queue.lastBaseUpdate = newLastBaseUpdate;
    // TODO:什么是Interleaved updates
    // Interleaved updates are stored on a separate queue. We aren't going to
    // process them during this render, but we do need to track which lanes
    // are remaining.

    var lastInterleaved = queue.shared.interleaved;

    if (lastInterleaved !== null) {
      var interleaved = lastInterleaved;

      do {
        newLanes = mergeLanes(newLanes, interleaved.lane);
        interleaved = interleaved.next;
      } while (interleaved !== lastInterleaved);
    } else if (firstBaseUpdate === null) {
      // `queue.lanes` is used for entangling transitions. We can set it back to
      // zero once the queue is empty.
      queue.shared.lanes = NoLanes;
    } // Set the remaining expiration time to be whatever is remaining in the queue.
    // This should be fine because the only two other things that contribute to
    // expiration time are props and context. We're already in the middle of the
    // begin phase by the time we start processing the queue, so we've already
    // dealt with the props. Context in components that specify
    // shouldComponentUpdate is tricky; but we'll have to account for
    // that regardless.

    // 标记workInProgress Fiber有哪些优先级的update被跳过
    markSkippedUpdateLanes(newLanes);
    // workInProgress Fiber还未处理完成的优先级集合
    workInProgress.lanes = newLanes;
    // 将计算的最终状态结果存储到memoizedState
    workInProgress.memoizedState = newState;
  }
}
```
