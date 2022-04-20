import "./App.css";
import { useMemo, useReducer, useRef, useState } from "react";

function Expensive() {
  const list = [...new Array(10)];
  console.log("expensive render", list.length);
  return (
    <div>
      {list.map((item, index) => {
        return <p key={index}>{index}</p>;
      })}
    </div>
  );
}

function App() {
  const [count, dispatch] = useReducer((state, action) => {
    switch (action.type) {
      case "inc":
        return action.data;
      default:
        throw new Error();
    }
  }, 1);
  const ref = useRef();

  console.log("=========render");

  return (
    <div ref={ref}>
      {count}
      <button
        onClick={() => {
          dispatch({
            type: "inc",
            data: 1,
          });
        }}
      >
        点我试一试
      </button>
      <Expensive />
    </div>
  );
}

export default App;
