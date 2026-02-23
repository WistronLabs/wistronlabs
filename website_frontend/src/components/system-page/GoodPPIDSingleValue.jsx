import { components as SelectComponents } from "react-select";
import { PULL_FROM_UNIT_VALUE } from "./systemPage.constants";

function GoodPPIDSingleValue(props) {
  const { data } = props;

  if (data.value === PULL_FROM_UNIT_VALUE) {
    return (
      <SelectComponents.SingleValue {...props}>
        <span className="text-blue-600 font-semibold">{data.label}</span>
      </SelectComponents.SingleValue>
    );
  }

  return <SelectComponents.SingleValue {...props} />;
}

export default GoodPPIDSingleValue;
