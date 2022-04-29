import { memo, useState } from "react";

function Child({ index }) {
  const [currentNum, setCurrentNum] = useState(0);
  return (
    <div>
      <div>{currentNum + index}</div>
      <button
        onClick={() => {
          setCurrentNum((cur) => ++cur);
        }}
      >
        click me
      </button>
    </div>
  );
}
const ChildWithMemo = memo(Child);

function App() {
  return (
    <div>

      {[...new Array(999).fill(null)].map((_, index) => {
        return <ChildWithMemo key={index} index={index} />;
      })}


      {/* {[...new Array(333).fill(null)].map((_, index) => {
        return <ChildWithMemo key={index} index={index} />;
      })}

      {[...new Array(333).fill(null)].map((_, index) => {
        return <ChildWithMemo key={index} index={index} />;
      })}

      {[...new Array(333).fill(null)].map((_, index) => {
        return <ChildWithMemo key={index} index={index} />;
      })} */}

    </div>
  );
}

export default App;
