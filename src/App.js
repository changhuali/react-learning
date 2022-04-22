import "./App.css";
import { useEffect, useReducer, useRef, StrictMode } from "react";

function GrandChild({ count }) {
  // useEffect(() => {
  //   console.log("GrandChild mount");
  //   return () => {
  //     console.log("GrandChild unmount");
  //   };
  // });
  return <div>{count}</div>;
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

const total = 1000;
function App() {
  const ref = useRef();
  const [count, dispatch] = useReducer((state, action) => {
    switch (action.type) {
      case "inc":
        return ++state;
      default:
        throw new Error();
    }
  }, 1);

  return (
    <StrictMode>
      {count}
      <button
        ref={ref}
        onClick={(evt) => {
          console.log(evt)
          dispatch({
            type: "inc",
          });
        }}
      >
        点我试一试
      </button>
      <div>
        {count & 1
          ? [...new Array(total).fill(null).map((_, index) => index)].map(
              (item) => {
                return <Child key={item} count={item} />;
              }
            )
          : [
              total - 1,
              ...new Array(total - 1).fill(null).map((_, index) => index),
            ].map((item) => {
              return <Child key={item} count={item} />;
            })}
      </div>
    </StrictMode>
  );
}

export default App;
