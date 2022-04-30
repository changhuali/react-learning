import { createContext, memo, useContext, useState } from "react";
import "./App.css";

const Context = createContext();
const useLocalContext = () => {
  return useContext(Context);
};

function C() {
  const local = useLocalContext();
  console.log('C render');
  return <div>C{local}</div>;
}

const MC = memo(C)

function B() {
  console.log("B render");
  return (
    <div>
      B
      <MC />
    </div>
  );
}

const MB = memo(B);

function A() {
  console.log("A render");
  return (
    <div>
      A
      <MB />
    </div>
  );
}

const MA = memo(A);

function App() {
  const [a, setA] = useState(111);
  console.log("App render");

  return (
    <>
      <button
        onClick={() => {
          setA((a) => ++a);
        }}
      >
        click me
      </button>
      <Context.Provider value={a}>
        <MA />
      </Context.Provider>
    </>
  );
}

export default App;
