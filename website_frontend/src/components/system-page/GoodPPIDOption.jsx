import { components as SelectComponents } from "react-select";
import { PULL_FROM_UNIT_VALUE } from "./systemPage.constants";

function GoodPPIDOption(props) {
  const { data } = props;

  if (data.value === PULL_FROM_UNIT_VALUE) {
    return (
      <SelectComponents.Option {...props}>
        <span className="text-blue-600 font-semibold">{data.label}</span>
      </SelectComponents.Option>
    );
  }

  return <SelectComponents.Option {...props} />;
}

export default GoodPPIDOption;
