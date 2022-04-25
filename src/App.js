import "./App.css";
import {
  useEffect,
  useReducer,
  useTransition,
  StrictMode,
  memo,
  useState,
} from "react";

function GrandChild({ count }) {
  useEffect(() => {
    return () => {};
  });
  return (
    <div>
      {new Array(1).fill(null).map((_, index) => (
        <span key={index}>{count}</span>
      ))}
    </div>
  );
}

function Child({ count }) {
  // useEffect(() => {
  //   console.log("Child mount");
  //   return () => {
  //     console.log("Child unmount");
  //   };
  // });
  return <GrandChild count={count} />;
}
const GC = memo(Child);
function App() {
  const [count, dispatch] = useReducer((state, action) => {
    switch (action.type) {
      case "inc":
        return ++state;
      default:
        throw new Error();
    }
  }, 1);

  const [_, startTransition] = useTransition();
  const [total, setTotal] = useState(2000);

  return (
    <StrictMode>
      {count}
      <button
        onClick={() => {
          dispatch({
            type: "inc",
          });
          startTransition(() => {
            setTotal((total) => {
              return total + 100;
            });
          });
        }}
      >
        click me
      </button>
      <div>
        {[...new Array(total).fill(null).map((_, index) => index)].map(
          (item) => {
            return <Child key={total - item} count={total - item} />;
          }
        )}
      </div>
    </StrictMode>
  );
}

export default App;
