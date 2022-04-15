import "./App.css";
import { useMemo, useRef, useState } from "react";

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
  const [count, setCount] = useState(0);
  const ref = useRef();

  const expensiveChild = useMemo(() => {
    return <Expensive ref={ref} />;
  }, []);

  return (
    <div ref={ref}>
      {count}
      <button
        onClick={() => {
          setCount((count) => {
            return ++count;
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
