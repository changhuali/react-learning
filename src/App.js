import "./App.css";
import { useEffect, useState } from "react";

function C1() {
  useEffect(() => {
    console.log("mount C1");
    return () => {
      console.log("unmount C1");
    };
  }, []);
  return <C2 />;
}

function C2() {
  useEffect(() => {
    console.log("mount C2");
    return () => {
      console.log("unmount C2");
    };
  }, []);
  return null;
}

function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    console.log("mount App");
    return () => {
      console.log("unmount App");
    };
  }, []);

  return (
    <div>
      {count % 2 === 0 ? <C1 /> : null}
      <button
        onClick={() => {
          setCount((count) => ++count);
        }}
      >
        {count}
      </button>
    </div>
  );
}

export default App;
